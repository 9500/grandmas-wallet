import {
  type ServiceCarriageFailure,
  type ServiceErrorCode,
  type ServiceFetch,
  type ServiceHelloSuccess,
  type ServiceMadeCategory,
  type ServicePossibleSuccess,
  type ServiceToken,
  type TemplateName,
  ServiceProtocolError,
  buildServiceHello,
  buildServiceJoinRequest,
  buildServicePossibleRequest,
  serviceExchange,
} from '@grandmas-wallet/connect';

/**
 * The wallet's three questions to an application's service (docs/xo-service.md): hello, what is possible, and join.
 * Each is one exchange over `serviceExchange`, with a typed answer or a failure in words the screens can show. It
 * keeps nothing and calls nothing by itself; the wallet speaks to a service only when the user acts.
 */

/** Why an exchange gave no usable answer. `declined`: the service answered and refused, in its own words. */
export type ServiceFailureKind = 'unreachable' | 'timeout' | 'cancelled' | 'busy' | 'failed' | 'unreadable' | 'too-large' | 'declined';

export interface ServiceCallFailure {
  ok: false;
  kind: ServiceFailureKind;
  /** Plain words for the screens. */
  message: string;
  /** The protocol's code, where the service or the carriage gave one. */
  code?: ServiceErrorCode;
  /** For `busy`: seconds to wait before asking again, as the service said. */
  retryAfter?: number;
}

export type ServiceCallResult<Answer> = ({ ok: true } & Answer) | ServiceCallFailure;

export interface ServiceCallOptions {
  /** The network the wallet is on, as the messages name it. */
  network: string;
  fetch?: ServiceFetch;
  /** Stops the exchange, when the user leaves. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** The message's identifier; a random one by default. */
  id?: string;
}

/**
 * The words the screens show about a template's service, in the wallet's voice. A refusal or failure is shown in the
 * words of the error the wallet throws (`declined`, `carriageFailure`), which use these.
 */
export const SERVICE_WORDS = {
  service: 'Service',
  connect: 'Connect',
  /** With the time of the answer the offered actions come from, as the screens write a time. */
  checked: (time: string): string => `Checked with its service ${time}`,
  fromService: 'From the service',
  declined: (words: string): string => `The service declined: ${words}`,
  unreachable: 'The service can\'t be reached. Nothing was sent.',
} as const;

const randomId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');

const NOTHING_SENT = 'Nothing was sent.';

/** The words for an exchange that gave no answer of the protocol. */
export const carriageFailure = (failure: ServiceCarriageFailure): ServiceCallFailure => {
  const code = failure.code === undefined ? {} : { code: failure.code };
  switch (failure.failure) {
    case 'unreachable':
    case 'redirect':
      return { ok: false, kind: 'unreachable', message: SERVICE_WORDS.unreachable, ...code };
    case 'timeout':
      return { ok: false, kind: 'timeout', message: `The service did not answer in time. ${NOTHING_SENT}`, ...code };
    case 'cancelled':
      return { ok: false, kind: 'cancelled', message: `Stopped. ${NOTHING_SENT}`, ...code };
    case 'request-too-large':
      return { ok: false, kind: 'too-large', message: `This is more than the service takes. ${NOTHING_SENT}`, ...code };
    case 'answer-too-large':
    case 'unreadable':
      return { ok: false, kind: 'unreadable', message: `The service's answer can't be read. ${NOTHING_SENT}`, ...code };
    case 'status':
      if (failure.status === 429 || failure.status === 503) {
        const wait = failure.retryAfter === undefined ? '' : ` Try again in ${failure.retryAfter} seconds.`;
        return { ok: false, kind: 'busy', message: `The service is busy.${wait} ${NOTHING_SENT}`, ...code, ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }) };
      }
      return { ok: false, kind: 'failed', message: `The service failed${failure.status === undefined ? '' : ` (HTTP ${failure.status})`}. ${NOTHING_SENT}`, ...code };
  }
};

/** The words for a service that answered and refused. Its own words are shown as they are, cut to the protocol's length. */
export const declined = (error: string, code?: ServiceErrorCode): ServiceCallFailure => ({ ok: false, kind: 'declined', message: SERVICE_WORDS.declined(error), ...(code === undefined ? {} : { code }) });

/** A message that cannot be made is not sent. */
const unsendable = (error: unknown): ServiceCallFailure => ({
  ok: false,
  kind: error instanceof ServiceProtocolError && (error.code === 'too-large' || error.code === 'too-many') ? 'too-large' : 'unreadable',
  message: `The request can't be made: ${error instanceof Error ? error.message : 'it is not valid'}. ${NOTHING_SENT}`,
  ...(error instanceof ServiceProtocolError && error.code !== undefined ? { code: error.code } : {}),
});

const exchangeOptions = (options: ServiceCallOptions) => ({
  ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
  ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
});

/** Whether the service serves the template, in which role, and within which limits. */
export const askServiceHello = async (url: string, question: { template: TemplateName; role: string }, options: ServiceCallOptions): Promise<ServiceCallResult<Omit<ServiceHelloSuccess, 'ok'>>> => {
  let message;
  try {
    message = buildServiceHello({ network: options.network, id: options.id ?? randomId(), template: question.template, role: question.role });
  } catch (error) {
    return unsendable(error);
  }
  const outcome = await serviceExchange(url, message, exchangeOptions(options));
  if (!outcome.carried) return carriageFailure(outcome);
  const { answer } = outcome;
  return answer.ok ? { ok: true, serves: answer.serves, limits: answer.limits } : declined(answer.error, answer.code);
};

/**
 * The role a hello answer says the service takes in a template, if it serves the template in a role other than the
 * wallet's.
 */
export const servedRole = (serves: ServiceHelloSuccess['serves'], template: TemplateName, walletRole: string): string | undefined =>
  serves.find((entry) => entry.template.identifier === template.identifier && entry.template.contentHash === template.contentHash && entry.role !== walletRole)?.role;

/** What the wallet can do with the template now: its starting actions, and the actions under its tokens. */
export const askServicePossible = async (
  url: string,
  question: { template: TemplateName; role: string; tokens: ServiceToken[]; made: ServiceMadeCategory[] },
  options: ServiceCallOptions,
): Promise<ServiceCallResult<Omit<ServicePossibleSuccess, 'ok'>>> => {
  let message;
  try {
    message = buildServicePossibleRequest({ network: options.network, id: options.id ?? randomId(), ...question });
  } catch (error) {
    return unsendable(error);
  }
  const outcome = await serviceExchange(url, message, exchangeOptions(options));
  if (!outcome.carried) return carriageFailure(outcome);
  const { answer } = outcome;
  return answer.ok ? { ok: true, height: answer.height, start: answer.start, items: answer.items } : declined(answer.error, answer.code);
};

/**
 * Ask the service to join an invitation the wallet started. The invitation it gives back is not trusted: it goes to
 * `takeJoinedInvitation` and `checkOtherParticipant`.
 */
export const askServiceJoin = async (url: string, question: { invitation: string; ref?: string }, options: ServiceCallOptions): Promise<ServiceCallResult<{ invitation: string }>> => {
  let message;
  try {
    message = buildServiceJoinRequest({ network: options.network, id: options.id ?? randomId(), invitation: question.invitation, ...(question.ref === undefined ? {} : { ref: question.ref }) });
  } catch (error) {
    return unsendable(error);
  }
  const outcome = await serviceExchange(url, message, exchangeOptions(options));
  if (!outcome.carried) return carriageFailure(outcome);
  const { answer } = outcome;
  return answer.ok ? { ok: true, invitation: answer.invitation } : declined(answer.error, answer.code);
};
