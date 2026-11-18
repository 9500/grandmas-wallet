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
/** Recoverer's page → wallet: what became of it. Also wallet → recoverer's page, to say that a hand-over was kept. */
export const SEALED_ANSWER = 'gw_recoverer_sealed_answer';
/** Wallet → recoverer's page: a phone's request to have its wallet set up, sealed to the recoverer's key. */
export const ENROLL = 'gw_recoverer_enroll';
/** Recoverer's page → wallet: the request has arrived, the wallet is created, or the request is refused with a reason. */
export const ENROLL_ANSWER = 'gw_recoverer_enroll_answer';
/** Recoverer's page → wallet: the hand-over after a recovery, sealed to the new phone's key. */
export const HAND_OVER = 'gw_recoverer_hand_over';

/**
 * What a sealed message is, as the link that would carry it names it: a recovery kit for a wallet (`enroll`,
 * for a first recoverer and for a replacement alike) or a new phone's takeover request (`takeover`).
 */
export type HandOffKind = 'enroll' | 'takeover';
const KINDS: readonly HandOffKind[] = ['enroll', 'takeover'];

/**
 * What a recoverer offers a phone it sets a wallet up for: the waiting period it creates wallets with, which the
 * phone shows as a fact and checks in the creation, and the starting balance, in satoshis as a decimal string.
 */
export interface Offer {
  challengeDelay: { unit: 'blocks' | 'time512'; value: number };
  startingSatoshis: string;
}

/** The recoverer as its link describes it. Not secret. */
export interface Particulars {
  name: string;
  /** The address of the recoverer's page. */
  page: string;
  /** Its encryption key, 32 bytes as hex. */
  publicKey: string;
  /** Sent by a page that sets wallets up; the link does not carry it. */
  offer?: Offer;
}

/** A sealed message with no kind of its own: a phone's set-up request, or a hand-over. */
export interface SealedOnly {
  time: number;
  /** Chosen by the sender. The same identifier is the same message, however often it arrives. */
  id: string;
  sealed: string;
}

export interface EnrollMessage extends SealedOnly {
  action: typeof ENROLL;
}

export interface HandOverMessage extends SealedOnly {
  action: typeof HAND_OVER;
}

/** The wallet the recoverer created: everything here is checked by the phone against the chain. */
export interface Created {
  identity: string;
  creationTransactionId: string;
  recoveryKeyHash: string;
}

export interface EnrollAnswer {
  action: typeof ENROLL_ANSWER;
  time: number;
  id: string;
  /** `received`: the page has it; a person may still have to say yes. `created`: here is the wallet. `refused`: with the reason. */
  status: 'received' | 'created' | 'refused';
  reason?: string;
  created?: Created;
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

export type RecovererMessage = ParticularsMessage | SealedMessage | SealedAnswer | EnrollMessage | EnrollAnswer | HandOverMessage;

/** The largest sealed message taken: far above a kit, which names what it does not carry. */
const LARGEST_SEALED = 1_000_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, longest: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= longest;

const readOffer = (value: unknown): Offer | undefined | false => {
  if (value === undefined) return undefined;
  if (!isObject(value) || !isObject(value['challengeDelay']) || typeof value['startingSatoshis'] !== 'string' || !/^\d{1,16}$/.test(value['startingSatoshis'])) return false;
  const { unit, value: amount } = value['challengeDelay'];
  if ((unit !== 'blocks' && unit !== 'time512') || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 65_535) return false;
  return { challengeDelay: { unit, value: amount }, startingSatoshis: value['startingSatoshis'] };
};

const readParticulars = (value: Record<string, unknown>): Particulars | undefined => {
  const { name, page, publicKey } = value;
  if (typeof name !== 'string' || name.length > 200 || !isText(page, 400) || typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) return undefined;
  try {
    if (!/^https?:$/.test(new URL(page).protocol)) return undefined;
  } catch {
    return undefined;
  }
  const offer = readOffer(value['offer']);
  if (offer === false) return undefined;
  return { name, page, publicKey, ...(offer === undefined ? {} : { offer }) };
};

const readSealedOnly = (message: Record<string, unknown>): Omit<SealedOnly, 'time'> | undefined => {
  const { id, sealed } = message;
  if (!isText(id, 80) || !isText(sealed, 2 * LARGEST_SEALED) || sealed.length % 2 !== 0 || !/^[0-9a-f]+$/.test(sealed)) return undefined;
  return { id, sealed };
};

const readCreated = (value: unknown): Created | undefined => {
  if (!isObject(value)) return undefined;
  const { identity, creationTransactionId, recoveryKeyHash } = value;
  const hex = (text: unknown, bytes: number): text is string => typeof text === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(text);
  if (!hex(identity, 32) || !hex(creationTransactionId, 32) || !hex(recoveryKeyHash, 20)) return undefined;
  return { identity, creationTransactionId, recoveryKeyHash };
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
  if (action === ENROLL || action === HAND_OVER) {
    const read = readSealedOnly(message);
    return read === undefined ? undefined : { action, time, ...read };
  }
  if (action === ENROLL_ANSWER) {
    const { id, status, reason } = message;
    if (!isText(id, 80) || !['received', 'created', 'refused'].includes(status as string) || (reason !== undefined && !isText(reason, 600))) return undefined;
    const created = readCreated(message['created']);
    if ((status === 'created') !== (created !== undefined)) return undefined;
    return { action, time, id, status: status as EnrollAnswer['status'], ...(reason === undefined ? {} : { reason }), ...(created === undefined ? {} : { created }) };
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

  private readonly handOvers = new Map<string, () => void>();

  constructor(
    private readonly options: {
      particulars: () => Particulars;
      /** A sealed message, the first time its identifier arrives. */
      onSealed: (received: ReceivedSealed) => void;
      /**
       * A phone's set-up request, every time it arrives: a phone sends it again until it has its answer, after a
       * reload too. The page answers from what it keeps about the request, so that it is carried out once.
       */
      onEnroll?: (received: { id: string; sealed: Uint8Array }) => void;
    },
  ) {}

  /** Answer a phone's set-up request. A request that arrives again is answered again by the page. */
  async answerEnroll(id: string, answer: Pick<EnrollAnswer, 'status' | 'reason' | 'created'>): Promise<void> {
    const message: EnrollAnswer = {
      action: ENROLL_ANSWER,
      time: now(),
      id,
      status: answer.status,
      ...(answer.reason === undefined ? {} : { reason: answer.reason.slice(0, 600) }),
      ...(answer.created === undefined ? {} : { created: answer.created }),
    };
    await this.channel?.send(message).catch(() => undefined);
  }

  /**
   * Hand the new phone what the recoverer made after a recovery, sealed to its key, and send it again every few
   * seconds until the phone says that it kept it.
   * @returns whether the phone said so within the time
   */
  async handOver(id: string, sealed: Uint8Array, options: { timeoutMs: number; resendMs?: number }): Promise<boolean> {
    let kept = false;
    this.handOvers.set(id, () => void (kept = true));
    const until = Date.now() + options.timeoutMs;
    try {
      while (!kept && Date.now() < until) {
        await this.channel?.send({ action: HAND_OVER, time: now(), id, sealed: binToHex(sealed) }).catch(() => undefined);
        const next = Math.min(until, Date.now() + (options.resendMs ?? 4_000));
        while (!kept && Date.now() < next) await wait(50);
      }
    } finally {
      this.handOvers.delete(id);
    }
    return kept;
  }

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
    if (message.action === ENROLL) {
      this.options.onEnroll?.({ id: message.id, sealed: hexToBin(message.sealed) });
      return;
    }
    if (message.action === SEALED_ANSWER && message.status === 'kept') {
      this.handOvers.get(message.id)?.();
      return;
    }
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
  private readonly enrollListeners = new Set<(answer: EnrollAnswer) => void>();
  private readonly handOverListeners = new Set<(message: { id: string; sealed: Uint8Array }) => void>();
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
      } else if (message.action === ENROLL_ANSWER) {
        for (const listener of [...this.enrollListeners]) listener(message);
      } else if (message.action === HAND_OVER) {
        for (const listener of [...this.handOverListeners]) listener({ id: message.id, sealed: hexToBin(message.sealed) });
      }
    });
  }

  /**
   * Send a phone's set-up request to the recoverer the code names, again every few seconds until the page answers
   * with the wallet or a refusal: a relay may lose a message, a person may have to say yes first, and either page may
   * be loaded again meanwhile. The same identifier is the same request; the page carries it out once.
   *
   * @param options.silentMs - how long the page has to say that it has the request at all
   * @param options.onReceived - called when the page says that it has the request
   * @returns the wallet the recoverer created, to be checked against the chain
   * @throws OtherRecovererError, SealedRefusedError, RecovererSilentError
   */
  async enroll(options: { expected: Particulars; id: string; sealed: Uint8Array; silentMs: number; timeoutMs: number; resendMs?: number; onReceived?: () => void }): Promise<Created> {
    const started = Date.now();
    const said = await this.particulars(options.silentMs);
    if (!sameRecoverer(said, options.expected)) throw new OtherRecovererError();
    let answered: EnrollAnswer | undefined;
    let received = false;
    const stop = this.onEnrollAnswer((answer) => {
      if (answer.id !== options.id) return;
      if (answer.status === 'received') {
        if (!received) options.onReceived?.();
        received = true;
      } else answered ??= answer;
    });
    const message: EnrollMessage = { action: ENROLL, time: now(), id: options.id, sealed: binToHex(options.sealed) };
    try {
      while (answered === undefined) {
        const limit = started + (received ? options.timeoutMs : options.silentMs);
        if (Date.now() >= limit) break;
        await this.channel.send({ ...message, time: now() }).catch(() => undefined);
        const next = Math.min(limit, Date.now() + (options.resendMs ?? 4_000));
        while (answered === undefined && Date.now() < next) await wait(50);
      }
    } finally {
      stop();
    }
    if (answered === undefined) throw new RecovererSilentError();
    if (answered.status === 'refused' || answered.created === undefined) throw new SealedRefusedError(answered.reason ?? 'The recoverer did not set the wallet up.');
    return answered.created;
  }

  /** Every answer to a set-up request from now on. Returns a function that stops the calls. */
  onEnrollAnswer(listener: (answer: EnrollAnswer) => void): () => void {
    this.enrollListeners.add(listener);
    return () => void this.enrollListeners.delete(listener);
  }

  /** Every hand-over the page sends from now on; the phone says it kept one with {@link acknowledge}. */
  onHandOver(listener: (message: { id: string; sealed: Uint8Array }) => void): () => void {
    this.handOverListeners.add(listener);
    return () => void this.handOverListeners.delete(listener);
  }

  /** Tell the page that a hand-over was kept, so that it stops sending it. */
  async acknowledge(id: string): Promise<void> {
    await this.channel.send({ action: SEALED_ANSWER, time: now(), id, status: 'kept' }).catch(() => undefined);
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
