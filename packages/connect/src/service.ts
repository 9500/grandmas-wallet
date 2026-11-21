/**
 * XO messages between a wallet and an application's service.
 *
 * A service is a server that takes part in an XO invitation as a second participant. The wallet starts an
 * invitation for an action of a template with the user's values and its own coins; the service joins it in a role
 * of its own, with the values only it knows, the application's shared coins with their unlocking and the
 * application's shared outputs; the wallet then checks everything, adds its own outputs, fee and change, and signs
 * once the user agrees. The wallet starts the invitation; the service checks it with the engine before joining.
 *
 * A template names its service by a resource whose name is `xo_service_v1`. The wallet knows nothing about the
 * application beforehand: everything it learns comes from the template, the chain and these messages, and the
 * wallet trusts none of what the service says until it has checked it against the template and the chain. A
 * service is recognised by its address in the template and by nothing else: an XO entity is new for each
 * invitation, so the hello answer carries no identity.
 *
 * Each message is one JSON object under the key `xo_service_v1`, posted to the resource's address and answered in
 * the same shape. The messages do not depend on how they travel. This module is the same in the wallet's page and
 * in a service: it uses nothing beyond `fetch`, `AbortController`, `TextEncoder`, `TextDecoder` and `URL`.
 *
 * Specification: docs/xo-service.md.
 */

import { type OutputBindings, type ParameterValue, type PositionAbout, type TemplateName, ProtocolError, isTemplateName, readAbout, readBindings } from './protocol.js';

export const XO_SERVICE = 'xo_service_v1';
/** The revision of `xo_service_v1`. Revisions inside one identifier are compatible; an incompatible change takes a new identifier. */
export const XO_SERVICE_VERSION = 1;

/**
 * The identifiers of service protocols this software speaks, the preferred first. A template's resource is a
 * service only if its name is one of these, exactly.
 */
export const SERVICE_IDENTIFIERS = [XO_SERVICE] as const;
export type ServiceIdentifier = (typeof SERVICE_IDENTIFIERS)[number];

export const SERVICE_HELLO = 'xo_service_hello';
export const SERVICE_HELLO_ANSWER = 'xo_service_hello_answer';
export const SERVICE_POSSIBLE_REQUEST = 'xo_service_possible_request';
export const SERVICE_POSSIBLE = 'xo_service_possible';
export const SERVICE_JOIN_REQUEST = 'xo_service_join_request';
export const SERVICE_JOIN_RESULT = 'xo_service_join_result';

/** The answer to each message the wallet sends. */
export const SERVICE_ANSWER_OF = {
  [SERVICE_HELLO]: SERVICE_HELLO_ANSWER,
  [SERVICE_POSSIBLE_REQUEST]: SERVICE_POSSIBLE,
  [SERVICE_JOIN_REQUEST]: SERVICE_JOIN_RESULT,
} as const;

export const SERVICE_LIMITS = {
  /** The largest body of a message to a service, in bytes. A service refuses a larger one with HTTP 413. */
  requestBytes: 65_536,
  /** The most of an answer a wallet reads, in bytes. A longer answer is a failure of the carriage. */
  answerBytes: 131_072,
  /** How long a wallet waits for an answer. */
  timeoutMs: 10_000,
  /** How long a wallet waits for the answer to a join. */
  joinTimeoutMs: 25_000,
  /** The most entries of any one list in a message: tokens, categories, items, roles, starting actions, statements, bindings. */
  entries: 32,
  /** The longest `ref`, in characters. */
  ref: 128,
  /** The longest `error`, in characters. */
  error: 200,
} as const;

/** The longest identifier of a message, as in `xo_v1`. */
const ID_LENGTH = 80;
/** The longest name of a network, of an action, of a role, of a variable. */
const NAME_LENGTH = 80;
/** The longest address of a service. */
const URL_LENGTH = 2_048;
/** The longest locking script, as hex: 10,000 bytes. */
const SCRIPT_HEX_LENGTH = 20_000;

/**
 * Why a service refused a message or could not do what was asked, in a form a wallet can act on, beside the words
 * of `error`. The same for every service.
 * - `inputs-spent`: a shared coin the service would use was spent by someone else first, or is no longer there.
 *   Asking again may work.
 * - `not-possible`: what was asked cannot be done now, for this token or with these values.
 * - `unknown-template`: the service does not serve this template, or not in this role.
 * - `wrong-network`: the service does not serve the network the message names.
 * - `version`: the message is of a revision of the protocol the service does not speak.
 * - `bad-invitation`: the invitation cannot be read, or is not one the service can join.
 * - `too-large`: the message, or a text in it, is larger than the limits allow.
 * - `too-many`: a list in the message has more entries than the limits allow.
 */
export const SERVICE_ERROR_CODES = ['inputs-spent', 'not-possible', 'unknown-template', 'wrong-network', 'version', 'bad-invitation', 'too-large', 'too-many'] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];
export const isServiceErrorCode = (value: unknown): value is ServiceErrorCode => (SERVICE_ERROR_CODES as readonly unknown[]).includes(value);

/** A message that is refused, with the code that says why where one fits. */
export class ServiceProtocolError extends ProtocolError {
  constructor(
    message: string,
    readonly code?: ServiceErrorCode,
  ) {
    super(message);
    this.name = 'ServiceProtocolError';
  }
}

interface ServiceEnvelope {
  /** {@link XO_SERVICE_VERSION}. */
  version: number;
  /** The network the message is about. A service at one address may serve several; it answers for the one named. */
  network: string;
  /** Chosen by the sender, and repeated in the answer. */
  id: string;
  /** Unix seconds. */
  time: number;
}

/** A refusal, or an action the service could not do. */
export interface ServiceFailure {
  ok: false;
  /** In plain words, at most {@link SERVICE_LIMITS.error} characters. */
  error: string;
  code?: ServiceErrorCode;
}

/** The wallet introduces itself: the template and the role it takes. Nothing else about the wallet. */
export interface ServiceHello extends ServiceEnvelope {
  action: typeof SERVICE_HELLO;
  template: TemplateName;
  role: string;
}

/** A role the service takes in a template. */
export interface ServiceRole {
  template: TemplateName;
  role: string;
}

/** The limits a service keeps, each at most the protocol's own. A wallet keeps within the smaller. */
export interface ServiceAnnouncedLimits {
  requestBytes: number;
  entries: number;
}

export interface ServiceHelloSuccess {
  ok: true;
  /** The templates the service serves, each with the role the service takes in it. */
  serves: ServiceRole[];
  limits: ServiceAnnouncedLimits;
}

export type ServiceHelloAnswer = ServiceEnvelope & { action: typeof SERVICE_HELLO_ANSWER } & (ServiceHelloSuccess | ServiceFailure);

/** An NFT the wallet holds under the template. */
export interface ServiceToken {
  /** Hex, as in `xo_v1`. */
  category: string;
  /** Hex; empty for none. */
  commitment: string;
  capability: 'none' | 'mutable' | 'minting';
  /** The coin that holds it, as `<transaction id>:<output index>`. */
  outpoint: string;
}

/** A token category the wallet created with one of the template's starting actions, and the transaction that did. */
export interface ServiceMadeCategory {
  category: string;
  transactionId: string;
}

/** The wallet asks what it can do with the template now. */
export interface ServicePossibleRequest extends ServiceEnvelope {
  action: typeof SERVICE_POSSIBLE_REQUEST;
  template: TemplateName;
  role: string;
  tokens: ServiceToken[];
  made: ServiceMadeCategory[];
}

/** Whether a starting action of the template can be carried out now. */
export interface ServiceStart {
  action: string;
  available: boolean;
  /** Why not, in plain words. */
  reason?: string;
}

/** A value the service states for display ("From the service"). The wallet never trusts it. */
export interface ServiceStatement {
  variable: string;
  value: ParameterValue;
}

/** An action the wallet can carry out now under one of its tokens. */
export interface ServiceItem {
  /** Opaque to the wallet and not a secret, sent back with a join. The service checks everything again then. */
  ref: string;
  /** The token the action belongs under. */
  category: string;
  /** An action identifier of the template. */
  action: string;
  /** Where the position is, as hex, so that the wallet can check it on the chain. */
  lockingScript?: string;
  /** The coin that is the position, as `<transaction id>:<output index>`. */
  coin?: string;
  /** As in an `xo_v1` request. */
  about?: PositionAbout;
  /** As in an `xo_v1` request. */
  bindings?: OutputBindings;
  says?: ServiceStatement[];
}

export interface ServicePossibleSuccess {
  ok: true;
  /** The height of the chain the service read. */
  height: number;
  start: ServiceStart[];
  items: ServiceItem[];
}

export type ServicePossible = ServiceEnvelope & { action: typeof SERVICE_POSSIBLE } & (ServicePossibleSuccess | ServiceFailure);

/** The wallet asks the service to join an invitation it started. */
export interface ServiceJoinRequest extends ServiceEnvelope {
  action: typeof SERVICE_JOIN_REQUEST;
  /** The `ref` of the item the action is for. Absent for a starting action. */
  ref?: string;
  /** XO's serialized invitation (`serializeInvitation` of `@xo-cash/utils`), holding the wallet's commit. */
  invitation: string;
}

export interface ServiceJoinSuccess {
  ok: true;
  /** The same invitation with the service's commit appended. */
  invitation: string;
}

export type ServiceJoinResult = ServiceEnvelope & { action: typeof SERVICE_JOIN_RESULT } & (ServiceJoinSuccess | ServiceFailure);

export type ServiceRequest = ServiceHello | ServicePossibleRequest | ServiceJoinRequest;
export type ServiceAnswer = ServiceHelloAnswer | ServicePossible | ServiceJoinResult;
export type ServiceMessage = ServiceRequest | ServiceAnswer;

/** The answer a wallet's message gets. */
export type ServiceAnswerTo<R extends ServiceRequest> = R extends ServiceHello ? ServiceHelloAnswer : R extends ServicePossibleRequest ? ServicePossible : ServiceJoinResult;

// ---------------------------------------------------------------------------------------------------------------
// Reading messages

/** What a parser checks a message against. */
export interface ServiceExpectation {
  /** The network the reader is on. A message about another is refused with `wrong-network`. */
  network: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isOutpoint = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}:\d{1,5}$/.test(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const encoder = new TextEncoder();
/** The length of a text in UTF-8 bytes. */
export const serviceByteLength = (text: string): number => encoder.encode(text).length;

const fail = (message: string, code?: ServiceErrorCode): never => {
  throw new ServiceProtocolError(message, code);
};

/** Refuse a field the message does not have in this version. */
const onlyFields = (value: Record<string, unknown>, allowed: readonly string[], what: string): void => {
  const unknown = Object.keys(value).find((name) => !allowed.includes(name));
  if (unknown !== undefined) fail(`The ${what} has a field this version does not know: "${unknown.slice(0, 40)}".`);
};

const readList = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) return fail(`The ${what} are not a list.`);
  if (value.length > SERVICE_LIMITS.entries) return fail(`The message has more ${what} than the ${SERVICE_LIMITS.entries} it may carry.`, 'too-many');
  return value;
};

const ENVELOPE = ['action', 'version', 'network', 'id', 'time'] as const;

/** The parts every message has. Checked in this order: what it is, its version, its fields, its network. */
const readEnvelope = (message: unknown, action: string, what: string, fields: readonly string[], expect: ServiceExpectation): ServiceEnvelope & Record<string, unknown> => {
  if (!isObject(message) || message['action'] !== action) return fail(`Not ${what}.`);
  const { version, network, id, time } = message;
  if (typeof version !== 'number') return fail(`The ${what} does not say its version.`, 'version');
  if (version !== XO_SERVICE_VERSION) return fail(`The ${what} is of version ${version} of ${XO_SERVICE}; this software speaks version ${XO_SERVICE_VERSION}.`, 'version');
  onlyFields(message, [...ENVELOPE, ...fields], what);
  if (!isText(network, NAME_LENGTH)) return fail(`The ${what} does not name its network.`);
  if (network !== expect.network) return fail(`The ${what} is about ${network.slice(0, 40)}, not ${expect.network}.`, 'wrong-network');
  if (!isText(id, ID_LENGTH) || !isCount(time)) return fail(`The ${what} is missing something or has a field of the wrong kind.`);
  return { ...message, version, network, id, time };
};

const readTemplate = (value: unknown, what: string): TemplateName => {
  if (!isTemplateName(value)) return fail(`The ${what} does not name its template by identifier and content hash.`);
  onlyFields(value as unknown as Record<string, unknown>, ['identifier', 'contentHash'], `${what}'s template`);
  return { identifier: value.identifier, contentHash: value.contentHash };
};

const FAILURE = ['ok', 'error', 'code'] as const;

/** The refusal in an answer. An unknown code is refused: the list is the same for every service. */
const readFailure = (message: Record<string, unknown>, what: string): ServiceFailure => {
  const { error, code } = message;
  if (!isText(error, SERVICE_LIMITS.error)) return fail(`The ${what} refuses without saying why in at most ${SERVICE_LIMITS.error} characters.`);
  if (code !== undefined && !isServiceErrorCode(code)) return fail(`The ${what} gives a reason code this version does not know.`);
  return { ok: false, error, ...(code === undefined ? {} : { code }) };
};

/** Read an answer's envelope and, if it is a refusal, the refusal. */
const readAnswer = (message: unknown, action: string, what: string, success: readonly string[], expect: ServiceExpectation): { envelope: ServiceEnvelope; body: Record<string, unknown>; failure?: ServiceFailure } => {
  const ok = isObject(message) ? message['ok'] : undefined;
  if (isObject(message) && ok !== true && ok !== false && message['action'] === action && message['version'] === XO_SERVICE_VERSION) fail(`The ${what} does not say whether it is a success.`);
  const read = readEnvelope(message, action, what, ok === true ? ['ok', ...success] : FAILURE, expect);
  const envelope: ServiceEnvelope = { version: read.version, network: read.network, id: read.id, time: read.time };
  return ok === true ? { envelope, body: read } : { envelope, body: read, failure: readFailure(read, what) };
};

/**
 * Check a message that claims to be a wallet's hello.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServiceHello = (message: unknown, expect: ServiceExpectation): ServiceHello => {
  const what = 'hello';
  const read = readEnvelope(message, SERVICE_HELLO, what, ['template', 'role'], expect);
  if (!isText(read['role'], NAME_LENGTH)) return fail('The hello does not name the wallet\'s role.');
  return { action: SERVICE_HELLO, version: read.version, network: read.network, id: read.id, time: read.time, template: readTemplate(read['template'], what), role: read['role'] };
};

const readLimits = (value: unknown): ServiceAnnouncedLimits => {
  if (!isObject(value)) return fail('The hello answer does not state the service\'s limits.');
  onlyFields(value, ['requestBytes', 'entries'], 'hello answer\'s limits');
  const { requestBytes, entries } = value;
  if (!isCount(requestBytes) || requestBytes < 1 || requestBytes > SERVICE_LIMITS.requestBytes || !isCount(entries) || entries < 1 || entries > SERVICE_LIMITS.entries) {
    return fail('The hello answer states limits beyond those of the protocol.');
  }
  return { requestBytes, entries };
};

/**
 * Check a message that claims to be a service's answer to a hello.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServiceHelloAnswer = (message: unknown, expect: ServiceExpectation): ServiceHelloAnswer => {
  const what = 'hello answer';
  const { envelope, body, failure } = readAnswer(message, SERVICE_HELLO_ANSWER, what, ['serves', 'limits'], expect);
  const head = { action: SERVICE_HELLO_ANSWER, ...envelope } as const;
  if (failure !== undefined) return { ...head, ...failure };
  const serves = readList(body['serves'], 'roles served').map((entry): ServiceRole => {
    if (!isObject(entry)) return fail('A role the service serves cannot be read.');
    onlyFields(entry, ['template', 'role'], 'role served');
    if (!isText(entry['role'], NAME_LENGTH)) return fail('A role the service serves has no name.');
    return { template: readTemplate(entry['template'], 'role served'), role: entry['role'] };
  });
  return { ...head, ok: true, serves, limits: readLimits(body['limits']) };
};

const CAPABILITIES = ['none', 'mutable', 'minting'] as const;

const readToken = (entry: unknown): ServiceToken => {
  if (!isObject(entry)) return fail('A token in the request cannot be read.');
  onlyFields(entry, ['category', 'commitment', 'capability', 'outpoint'], 'token');
  const { category, commitment, capability, outpoint } = entry;
  if (!isHash(category) || typeof commitment !== 'string' || !/^(?:[0-9a-f]{2}){0,128}$/.test(commitment) || !(CAPABILITIES as readonly unknown[]).includes(capability) || !isOutpoint(outpoint)) {
    return fail('A token in the request is not in the form of category, commitment, capability and outpoint.');
  }
  return { category, commitment, capability: capability as ServiceToken['capability'], outpoint };
};

/**
 * Check a message that claims to be a wallet's question of what is possible.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServicePossibleRequest = (message: unknown, expect: ServiceExpectation): ServicePossibleRequest => {
  const what = 'possible request';
  const read = readEnvelope(message, SERVICE_POSSIBLE_REQUEST, what, ['template', 'role', 'tokens', 'made'], expect);
  if (!isText(read['role'], NAME_LENGTH)) return fail('The possible request does not name the wallet\'s role.');
  const template = readTemplate(read['template'], what);
  const tokens = readList(read['tokens'], 'tokens').map(readToken);
  const made = readList(read['made'], 'categories made').map((entry): ServiceMadeCategory => {
    if (!isObject(entry)) return fail('A category in the request cannot be read.');
    onlyFields(entry, ['category', 'transactionId'], 'category made');
    if (!isHash(entry['category']) || !isHash(entry['transactionId'])) return fail('A category in the request is not in the form of category and transaction identifier.');
    return { category: entry['category'], transactionId: entry['transactionId'] };
  });
  return { action: SERVICE_POSSIBLE_REQUEST, version: read.version, network: read.network, id: read.id, time: read.time, template, role: read['role'], tokens, made };
};

const readValue = (value: unknown): value is ParameterValue => (typeof value === 'string' && value.length <= 400) || (typeof value === 'number' && Number.isFinite(value));

const readItem = (entry: unknown): ServiceItem => {
  if (!isObject(entry)) return fail('An item of the answer cannot be read.');
  onlyFields(entry, ['ref', 'category', 'action', 'lockingScript', 'coin', 'about', 'bindings', 'says'], 'item');
  const { ref, category, action, lockingScript, coin, about, bindings, says } = entry;
  if (typeof ref === 'string' && ref.length > SERVICE_LIMITS.ref) return fail(`An item's ref is longer than ${SERVICE_LIMITS.ref} characters.`, 'too-large');
  if (!isText(ref, SERVICE_LIMITS.ref) || !isHash(category) || !isText(action, NAME_LENGTH)) return fail('An item of the answer is missing its ref, category or action.');
  if (lockingScript !== undefined && (typeof lockingScript !== 'string' || lockingScript.length > SCRIPT_HEX_LENGTH || !/^(?:[0-9a-f]{2})+$/.test(lockingScript))) return fail('An item gives its locking script in a form this version does not accept.');
  if (coin !== undefined && !isOutpoint(coin)) return fail('An item names its coin in a form this version does not accept.');
  const position = about === undefined ? undefined : readAbout(about);
  if (about !== undefined && (position === undefined || Object.keys(about as object).length !== 2)) return fail('An item names the position it is about in a form this version does not accept.');
  const bound = bindings === undefined ? undefined : readBindings(bindings);
  if (bindings !== undefined && bound === undefined) return fail('An item\'s bindings are not names.');
  if (bound !== undefined && Object.keys(bound).length > SERVICE_LIMITS.entries) return fail(`An item has more bindings than the ${SERVICE_LIMITS.entries} it may carry.`, 'too-many');
  const statements =
    says === undefined
      ? undefined
      : readList(says, 'statements').map((statement): ServiceStatement => {
          if (!isObject(statement)) return fail('A statement of the service cannot be read.');
          onlyFields(statement, ['variable', 'value'], 'statement');
          if (!isText(statement['variable'], NAME_LENGTH) || !readValue(statement['value'])) return fail('A statement of the service is not in the form of variable and value.');
          return { variable: statement['variable'], value: statement['value'] };
        });
  return {
    ref,
    category,
    action,
    ...(lockingScript === undefined ? {} : { lockingScript: lockingScript as string }),
    ...(coin === undefined ? {} : { coin: coin as string }),
    ...(position === undefined ? {} : { about: position }),
    ...(bound === undefined ? {} : { bindings: bound }),
    ...(statements === undefined ? {} : { says: statements }),
  };
};

/**
 * Check a message that claims to be a service's answer of what is possible.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServicePossible = (message: unknown, expect: ServiceExpectation): ServicePossible => {
  const what = 'possible answer';
  const { envelope, body, failure } = readAnswer(message, SERVICE_POSSIBLE, what, ['height', 'start', 'items'], expect);
  const head = { action: SERVICE_POSSIBLE, ...envelope } as const;
  if (failure !== undefined) return { ...head, ...failure };
  if (!isCount(body['height'])) return fail('The possible answer does not give the height of the chain it read.');
  const start = readList(body['start'], 'starting actions').map((entry): ServiceStart => {
    if (!isObject(entry)) return fail('A starting action of the answer cannot be read.');
    onlyFields(entry, ['action', 'available', 'reason'], 'starting action');
    const { action, available, reason } = entry;
    if (!isText(action, NAME_LENGTH) || typeof available !== 'boolean') return fail('A starting action of the answer is not in the form of action and availability.');
    if (reason !== undefined && !isText(reason, SERVICE_LIMITS.error)) return fail(`A starting action gives a reason longer than ${SERVICE_LIMITS.error} characters, or an empty one.`);
    return { action, available, ...(reason === undefined ? {} : { reason }) };
  });
  return { ...head, ok: true, height: body['height'], start, items: readList(body['items'], 'items').map(readItem) };
};

/** What this module reads of an invitation without the engine. */
export interface InvitationOutline {
  invitationIdentifier: string;
  templateIdentifier: string;
  actionIdentifier: string;
  commits: { commitIdentifier: string; entityIdentifier: string }[];
}

/**
 * Read the outline of XO's serialized invitation: JSON with the invitation's identifiers and a list of commits,
 * each with its identifier and its entity. Nothing else is checked here; the engine checks the rest.
 * @throws ServiceProtocolError with `bad-invitation` if the text is not in that form
 */
export const readInvitationOutline = (text: string): InvitationOutline => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('The invitation is not JSON.', 'bad-invitation');
  }
  if (!isObject(value)) return fail('The invitation is not an object.', 'bad-invitation');
  const { invitationIdentifier, templateIdentifier, actionIdentifier, commits } = value;
  if (!isText(invitationIdentifier, 200) || !isText(templateIdentifier, 200) || !isText(actionIdentifier, 200) || !Array.isArray(commits)) {
    return fail('The invitation does not have its identifiers and commits.', 'bad-invitation');
  }
  return {
    invitationIdentifier,
    templateIdentifier,
    actionIdentifier,
    commits: commits.map((commit) => {
      if (!isObject(commit) || !isText(commit['commitIdentifier'], 200) || !isText(commit['entityIdentifier'], 200)) return fail('A commit of the invitation has no identifier or entity.', 'bad-invitation');
      return { commitIdentifier: commit['commitIdentifier'], entityIdentifier: commit['entityIdentifier'] };
    }),
  };
};

const readInvitation = (value: unknown, what: string, maximum: number, commits: number): string => {
  if (typeof value === 'string' && value.length > maximum) return fail(`The invitation in the ${what} is larger than the protocol allows.`, 'too-large');
  if (!isText(value, maximum)) return fail(`The ${what} carries no invitation.`, 'bad-invitation');
  if (readInvitationOutline(value).commits.length < commits) return fail(`The invitation in the ${what} has fewer commits than it must.`, 'bad-invitation');
  return value;
};

/**
 * Check a message that claims to be a wallet's request to join an invitation.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServiceJoinRequest = (message: unknown, expect: ServiceExpectation): ServiceJoinRequest => {
  const what = 'join request';
  const read = readEnvelope(message, SERVICE_JOIN_REQUEST, what, ['ref', 'invitation'], expect);
  const { ref } = read;
  if (typeof ref === 'string' && ref.length > SERVICE_LIMITS.ref) return fail(`The join request's ref is longer than ${SERVICE_LIMITS.ref} characters.`, 'too-large');
  if (ref !== undefined && !isText(ref, SERVICE_LIMITS.ref)) return fail('The join request\'s ref is not text.');
  const invitation = readInvitation(read['invitation'], what, SERVICE_LIMITS.requestBytes, 1);
  return { action: SERVICE_JOIN_REQUEST, version: read.version, network: read.network, id: read.id, time: read.time, ...(ref === undefined ? {} : { ref: ref as string }), invitation };
};

/**
 * Check a message that claims to be a service's answer to a join.
 * @throws ServiceProtocolError if it is not one this version understands
 */
export const parseServiceJoinResult = (message: unknown, expect: ServiceExpectation): ServiceJoinResult => {
  const what = 'join result';
  const { envelope, body, failure } = readAnswer(message, SERVICE_JOIN_RESULT, what, ['invitation'], expect);
  const head = { action: SERVICE_JOIN_RESULT, ...envelope } as const;
  if (failure !== undefined) return { ...head, ...failure };
  return { ...head, ok: true, invitation: readInvitation(body['invitation'], what, SERVICE_LIMITS.answerBytes, 2) };
};

/**
 * Check a message a service receives.
 * @throws ServiceProtocolError if it is not one of the wallet's messages this version understands
 */
export const parseServiceRequest = (message: unknown, expect: ServiceExpectation): ServiceRequest => {
  const action = isObject(message) ? message['action'] : undefined;
  if (action === SERVICE_HELLO) return parseServiceHello(message, expect);
  if (action === SERVICE_POSSIBLE_REQUEST) return parseServicePossibleRequest(message, expect);
  if (action === SERVICE_JOIN_REQUEST) return parseServiceJoinRequest(message, expect);
  return fail(`Not a message a wallet sends in ${XO_SERVICE}.`);
};

/**
 * Check a message a wallet receives.
 * @throws ServiceProtocolError if it is not one of a service's answers this version understands
 */
export const parseServiceAnswer = (message: unknown, expect: ServiceExpectation): ServiceAnswer => {
  const action = isObject(message) ? message['action'] : undefined;
  if (action === SERVICE_HELLO_ANSWER) return parseServiceHelloAnswer(message, expect);
  if (action === SERVICE_POSSIBLE) return parseServicePossible(message, expect);
  if (action === SERVICE_JOIN_RESULT) return parseServiceJoinResult(message, expect);
  return fail(`Not an answer of a service in ${XO_SERVICE}.`);
};

/** The body that carries a message: the message under the protocol's identifier. */
export const encodeServiceBody = (message: ServiceMessage): string => JSON.stringify({ [XO_SERVICE]: message });

/**
 * Take the message out of a body.
 * @throws ServiceProtocolError if the body is not JSON with the protocol's identifier as its one key
 */
export const decodeServiceBody = (text: string): unknown => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('The body is not JSON.');
  }
  if (!isObject(value) || Object.keys(value).length !== 1 || !isObject(value[XO_SERVICE])) return fail(`The body does not hold one message under "${XO_SERVICE}".`);
  return value[XO_SERVICE];
};

// ---------------------------------------------------------------------------------------------------------------
// Making messages. Each builder checks what it makes with the parser the other side uses.

const now = (): number => Math.floor(Date.now() / 1000);

/** What the sender gives for any message: the network, an identifier of its choosing, and the time if not now. */
export interface ServiceEnvelopeFields {
  network: string;
  id: string;
  time?: number;
}

const envelopeOf = (fields: ServiceEnvelopeFields): ServiceEnvelope => ({ version: XO_SERVICE_VERSION, network: fields.network, id: fields.id, time: fields.time ?? now() });

/** A refusal in at most {@link SERVICE_LIMITS.error} characters. */
const failureOf = (failure: ServiceFailure): ServiceFailure => ({
  ok: false,
  error: failure.error.length === 0 ? 'The service refused.' : failure.error.slice(0, SERVICE_LIMITS.error),
  ...(failure.code === undefined ? {} : { code: failure.code }),
});

/** @throws ServiceProtocolError if the fields do not make a valid hello */
export const buildServiceHello = (fields: ServiceEnvelopeFields & { template: TemplateName; role: string }): ServiceHello =>
  parseServiceHello({ action: SERVICE_HELLO, ...envelopeOf(fields), template: fields.template, role: fields.role }, fields);

/** @throws ServiceProtocolError if the fields do not make a valid request */
export const buildServicePossibleRequest = (fields: ServiceEnvelopeFields & { template: TemplateName; role: string; tokens: ServiceToken[]; made: ServiceMadeCategory[] }): ServicePossibleRequest =>
  parseServicePossibleRequest({ action: SERVICE_POSSIBLE_REQUEST, ...envelopeOf(fields), template: fields.template, role: fields.role, tokens: fields.tokens, made: fields.made }, fields);

/** @throws ServiceProtocolError if the fields do not make a valid request */
export const buildServiceJoinRequest = (fields: ServiceEnvelopeFields & { ref?: string; invitation: string }): ServiceJoinRequest =>
  parseServiceJoinRequest({ action: SERVICE_JOIN_REQUEST, ...envelopeOf(fields), ...(fields.ref === undefined ? {} : { ref: fields.ref }), invitation: fields.invitation }, fields);

/** What a service answers a hello with. Without `limits`, the protocol's own. */
export type ServiceHelloOutcome = (Omit<ServiceHelloSuccess, 'limits'> & { limits?: ServiceAnnouncedLimits }) | ServiceFailure;
export type ServicePossibleOutcome = ServicePossibleSuccess | ServiceFailure;
export type ServiceJoinOutcome = ServiceJoinSuccess | ServiceFailure;

/** @throws ServiceProtocolError if the outcome does not make a valid answer */
export const buildServiceHelloAnswer = (fields: ServiceEnvelopeFields, outcome: ServiceHelloOutcome): ServiceHelloAnswer =>
  parseServiceHelloAnswer(
    {
      action: SERVICE_HELLO_ANSWER,
      ...envelopeOf(fields),
      ...(outcome.ok ? { ok: true, serves: outcome.serves, limits: outcome.limits ?? { requestBytes: SERVICE_LIMITS.requestBytes, entries: SERVICE_LIMITS.entries } } : failureOf(outcome)),
    },
    fields,
  );

/** @throws ServiceProtocolError if the outcome does not make a valid answer */
export const buildServicePossible = (fields: ServiceEnvelopeFields, outcome: ServicePossibleOutcome): ServicePossible =>
  parseServicePossible({ action: SERVICE_POSSIBLE, ...envelopeOf(fields), ...(outcome.ok ? { ok: true, height: outcome.height, start: outcome.start, items: outcome.items } : failureOf(outcome)) }, fields);

/** @throws ServiceProtocolError if the outcome does not make a valid answer */
export const buildServiceJoinResult = (fields: ServiceEnvelopeFields, outcome: ServiceJoinOutcome): ServiceJoinResult =>
  parseServiceJoinResult({ action: SERVICE_JOIN_RESULT, ...envelopeOf(fields), ...(outcome.ok ? { ok: true, invitation: outcome.invitation } : failureOf(outcome)) }, fields);

// ---------------------------------------------------------------------------------------------------------------
// The invitation a service gives back

const sameJson = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every((name) => Object.hasOwn(b, name) && sameJson(a[name], b[name]));
  }
  return a === b;
};

export type JoinedInvitationCheck = { ok: true; added: { commitIdentifier: string; entityIdentifier: string } } | { ok: false; reason: string };

/**
 * The first checks of an invitation a service gave back, which need no engine: it is the invitation the wallet
 * sent, unchanged in every part, with exactly one commit appended, and that commit names no other template or
 * action. Its signature and what it holds are for the wallet to check with the engine and the chain afterwards
 * (docs/xo-service.md, "What a wallet must check before signing").
 */
export const checkJoinedInvitation = (sent: string, received: string): JoinedInvitationCheck => {
  let before: InvitationOutline;
  let after: InvitationOutline;
  try {
    before = readInvitationOutline(sent);
    after = readInvitationOutline(received);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (after.commits.length !== before.commits.length + 1) return { ok: false, reason: `The service's invitation has ${after.commits.length - before.commits.length} new commits; it must have exactly one.` };
  const original = JSON.parse(sent) as Record<string, unknown>;
  const returned = JSON.parse(received) as Record<string, unknown> & { commits: unknown[] };
  const added = returned.commits[returned.commits.length - 1] as Record<string, unknown>;
  if (!sameJson({ ...returned, commits: returned.commits.slice(0, -1) }, original)) return { ok: false, reason: 'The service changed the invitation beyond adding its commit.' };
  const reference = added['actionReference'];
  if (reference !== undefined && !(isObject(reference) && reference['templateIdentifier'] === after.templateIdentifier && reference['actionIdentifier'] === after.actionIdentifier)) {
    return { ok: false, reason: 'The service\'s commit names another template or action.' };
  }
  return { ok: true, added: after.commits[after.commits.length - 1] as InvitationOutline['commits'][number] };
};

// ---------------------------------------------------------------------------------------------------------------
// Where a template names its service

/**
 * The networks a resource's name may name after the identifier, spelled as the `network` field of the messages
 * (and of `xo_v1`'s advertisement). A name with any other suffix is not a service's.
 */
export const SERVICE_NETWORK_NAMES = ['mainnet', 'chipnet', 'testnet3', 'testnet4', 'regtest', 'mockup'] as const;
export type ServiceNetworkName = (typeof SERVICE_NETWORK_NAMES)[number];

/** The kind of network the wallet is on: `local` (a regtest chain of one's own, reached on one's own machine or network) allows `http:`. */
export type ServiceNetworkKind = 'public' | 'local';

/** A template's service, or why the one it names cannot be used. */
export type ServiceResource =
  | {
      identifier: ServiceIdentifier;
      /** The resource's name: the identifier, or the identifier and the network, as `xo_service_v1:chipnet`. */
      name: string;
      usable: true;
      url: string;
      description: string;
    }
  | {
      identifier: ServiceIdentifier;
      name: string;
      usable: false;
      /** `address`: the address is not one a wallet may post to. `twice`: the template has more than one resource of this name. */
      problem: 'address' | 'twice';
      reason: string;
    };

/**
 * Why an address cannot be a service's, if it cannot: it must be `https:` (`http:` on a local network only), with
 * a host, and with no user name, password, query or fragment.
 */
export const serviceAddressProblem = (url: unknown, kind: ServiceNetworkKind): string | undefined => {
  if (typeof url !== 'string' || url.length === 0 || url.length > URL_LENGTH) return 'The address is not text of a usable length.';
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return 'The address has spaces or control characters.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'The address cannot be read.';
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && kind === 'local')) return kind === 'local' ? 'The address is neither https nor http.' : 'The address is not https.';
  if (parsed.hostname === '') return 'The address has no host.';
  if (parsed.username !== '' || parsed.password !== '' || /^[a-z]+:\/\/[^/]*@/i.test(url)) return 'The address carries a user name or password.';
  if (url.includes('?')) return 'The address carries a query.';
  if (url.includes('#')) return 'The address carries a fragment.';
  return undefined;
};

/**
 * Find the service a template names for the network the wallet is on.
 *
 * A resource is a service only if its name is one of {@link SERVICE_IDENTIFIERS} exactly (the service for every
 * network), or such an identifier, a colon and one of {@link SERVICE_NETWORK_NAMES} (the service for that network
 * only). Every other resource is ignored. Under each identifier, the resource for the wallet's network is used if
 * there is one, and otherwise the one for every network; two resources of that same name leave no usable service
 * under the identifier. Of the known identifiers, the most preferred with a usable service is taken; if none is
 * usable, the most preferred one found is reported with why it cannot be used.
 * @param source the template, or its `resources`
 * @returns `undefined` if the template names no service for this network
 */
export const findServiceResource = (source: unknown, wallet: { network: string; kind: ServiceNetworkKind }): ServiceResource | undefined => {
  const resources = Array.isArray(source) ? source : isObject(source) && Array.isArray(source['resources']) ? source['resources'] : [];
  const named = (name: string) => resources.filter((resource): resource is Record<string, unknown> => isObject(resource) && resource['name'] === name);
  const specific = (SERVICE_NETWORK_NAMES as readonly string[]).includes(wallet.network);
  const findings: ServiceResource[] = [];
  for (const identifier of SERVICE_IDENTIFIERS) {
    const forNetwork = specific ? named(`${identifier}:${wallet.network}`) : [];
    const candidates = forNetwork.length > 0 ? forNetwork : named(identifier);
    if (candidates.length === 0) continue;
    const name = candidates[0]?.['name'] as string;
    if (candidates.length > 1) {
      findings.push({ identifier, name, usable: false, problem: 'twice', reason: `The template has more than one resource named ${name}.` });
      continue;
    }
    const resource = candidates[0] as Record<string, unknown>;
    const problem = serviceAddressProblem(resource['url'], wallet.kind);
    if (problem !== undefined) {
      findings.push({ identifier, name, usable: false, problem: 'address', reason: problem });
      continue;
    }
    return { identifier, name, usable: true, url: resource['url'] as string, description: typeof resource['description'] === 'string' ? resource['description'] : '' };
  }
  return findings[0];
};

// ---------------------------------------------------------------------------------------------------------------
// The wallet's side of the carriage

/** The fetch the carrier uses: the browser's or Node's, or a replacement in tests. */
export type ServiceFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ServiceExchangeOptions {
  fetch?: ServiceFetch;
  /** Default {@link SERVICE_LIMITS.timeoutMs}, or {@link SERVICE_LIMITS.joinTimeoutMs} for a join. */
  timeoutMs?: number;
  /** Default {@link SERVICE_LIMITS.answerBytes}. */
  maxBytes?: number;
  /** Stops the exchange, when the user leaves. */
  signal?: AbortSignal;
}

/**
 * The message did not get an answer of the protocol.
 * - `request-too-large`: the message is larger than a service takes. It was not sent.
 * - `unreachable`: no answer: the service could not be reached, or it answered with a redirect, which is not followed.
 * - `redirect`: the service answered with a redirect.
 * - `timeout`, `cancelled`: no answer in time, or the caller stopped waiting.
 * - `status`: an HTTP status other than 200, with the service's words and code where its body gives them.
 * - `answer-too-large`: the answer is larger than the wallet reads.
 * - `unreadable`: the answer is not an answer to this message in this version; `code` says why where one fits.
 */
export interface ServiceCarriageFailure {
  carried: false;
  failure: 'request-too-large' | 'unreachable' | 'redirect' | 'timeout' | 'cancelled' | 'status' | 'answer-too-large' | 'unreadable';
  reason: string;
  status?: number;
  /** For 429 and 503: seconds to wait before asking again, as the service said. */
  retryAfter?: number;
  code?: ServiceErrorCode;
}

export type ServiceExchangeOutcome<A extends ServiceAnswer> = { carried: true; answer: A } | ServiceCarriageFailure;

const retryAfterOf = (header: string | null): number | undefined => {
  if (header === null) return undefined;
  if (/^\d{1,9}$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
};

/** The service's words and code in the body of a failure of the carriage, if it gave them. */
const carriageWords = (text: string): { error?: string; code?: ServiceErrorCode } => {
  try {
    const message = decodeServiceBody(text);
    if (!isObject(message)) return {};
    return {
      ...(isText(message['error'], SERVICE_LIMITS.error) ? { error: message['error'] } : {}),
      ...(isServiceErrorCode(message['code']) ? { code: message['code'] } : {}),
    };
  } catch {
    return {};
  }
};

class Stopped extends Error {}

/**
 * Post one message to a service and read its answer. Sends no credentials and no referrer, follows no redirect,
 * stores nothing, reads at most `maxBytes`, and gives up after `timeoutMs`. Never throws.
 * @returns the answer, checked as the answer to this message (its action, its `id` and its network), or why there is none
 */
export const serviceExchange = async <R extends ServiceRequest>(url: string, message: R, options: ServiceExchangeOptions = {}): Promise<ServiceExchangeOutcome<ServiceAnswerTo<R>>> => {
  const failure = (kind: ServiceCarriageFailure['failure'], reason: string, more: Partial<ServiceCarriageFailure> = {}): ServiceCarriageFailure => ({ carried: false, failure: kind, reason, ...more });
  const body = encodeServiceBody(message);
  if (serviceByteLength(body) > SERVICE_LIMITS.requestBytes) return failure('request-too-large', `The message is larger than the ${SERVICE_LIMITS.requestBytes} bytes a service takes.`, { code: 'too-large' });
  const send = options.fetch ?? ((address: string, init: RequestInit) => fetch(address, init));
  const timeoutMs = options.timeoutMs ?? (message.action === SERVICE_JOIN_REQUEST ? SERVICE_LIMITS.joinTimeoutMs : SERVICE_LIMITS.timeoutMs);
  const maxBytes = options.maxBytes ?? SERVICE_LIMITS.answerBytes;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted === true) controller.abort();
  const stopped = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) reject(new Stopped());
    controller.signal.addEventListener('abort', () => reject(new Stopped()), { once: true });
  });
  stopped.catch(() => undefined);
  const ended = () => (timedOut ? failure('timeout', `The service did not answer within ${Math.round(timeoutMs / 1000)} seconds.`) : failure('cancelled', 'The exchange was stopped.'));
  try {
    let response: Response;
    try {
      response = await Promise.race([
        send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', mode: 'cors', signal: controller.signal }),
        stopped,
      ]);
    } catch {
      if (controller.signal.aborted) return ended();
      return failure('unreachable', 'The service could not be reached, or it answered with a redirect, which is not followed.');
    }
    if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) return failure('redirect', 'The service answered with a redirect, which is not followed.');
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      return failure('answer-too-large', `The answer is larger than the ${maxBytes} bytes a wallet reads.`);
    }
    const parts: Uint8Array[] = [];
    let length = 0;
    if (response.body !== null) {
      const reader = response.body.getReader();
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), stopped]);
        } catch {
          void reader.cancel().catch(() => undefined);
          if (controller.signal.aborted) return ended();
          return failure('unreachable', 'The answer broke off.');
        }
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxBytes) {
          void reader.cancel().catch(() => undefined);
          return failure('answer-too-large', `The answer is larger than the ${maxBytes} bytes a wallet reads.`);
        }
        parts.push(chunk.value);
      }
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return failure('unreadable', 'The answer is not text.');
    }
    if (response.status !== 200) {
      const words = carriageWords(text);
      const retryAfter = retryAfterOf(response.headers.get('retry-after'));
      return failure('status', words.error ?? `The service answered with HTTP ${response.status}.`, {
        status: response.status,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        ...(words.code === undefined ? {} : { code: words.code }),
      });
    }
    try {
      const answer = parseServiceAnswer(decodeServiceBody(text), { network: message.network });
      if (answer.action !== SERVICE_ANSWER_OF[message.action]) return failure('unreadable', `The service answered with ${answer.action} to ${message.action}.`);
      if (answer.id !== message.id) return failure('unreadable', 'The service answered another message.');
      return { carried: true, answer: answer as ServiceAnswerTo<R> };
    } catch (error) {
      const code = error instanceof ServiceProtocolError ? error.code : undefined;
      return failure('unreadable', error instanceof Error ? error.message : 'The answer cannot be read.', code === undefined ? {} : { code });
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
};

// ---------------------------------------------------------------------------------------------------------------
// The service's side of the carriage

/** The headers of every answer of a service: any page may post, without credentials, and read the answer. */
export const SERVICE_CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '600',
};

/** What a service does for each message. A handler that throws is answered with HTTP 500. */
export interface ServiceHandlers {
  hello(request: ServiceHello): ServiceHelloOutcome | Promise<ServiceHelloOutcome>;
  possible(request: ServicePossibleRequest): ServicePossibleOutcome | Promise<ServicePossibleOutcome>;
  join(request: ServiceJoinRequest): ServiceJoinOutcome | Promise<ServiceJoinOutcome>;
}

/** The networks a service serves, each with its handlers. The same handlers may serve several. */
export type ServiceNetworks = Readonly<Record<string, ServiceHandlers>>;

/** An HTTP request as the server received it. The server stops reading a body at `requestBytes + 1` bytes. */
export interface ServiceHttpRequest {
  method: string;
  body?: string | Uint8Array;
}

export interface ServiceHttpAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const answerHeaders = (more: Record<string, string> = {}): Record<string, string> => ({ ...SERVICE_CORS_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...more });

/**
 * A failure of the carriage, in the shape of a message so that a wallet can read the words: for 400, 405, 413,
 * 429 (with `retryAfter` seconds), 500 and 503.
 */
export const serviceCarriageFailure = (status: number, error: string, options: { code?: ServiceErrorCode; retryAfter?: number; time?: number } = {}): ServiceHttpAnswer => ({
  status,
  headers: answerHeaders({ ...(options.retryAfter === undefined ? {} : { 'retry-after': String(Math.max(0, Math.ceil(options.retryAfter))) }), ...(status === 405 ? { allow: 'POST, OPTIONS' } : {}) }),
  body: JSON.stringify({ [XO_SERVICE]: { version: XO_SERVICE_VERSION, time: options.time ?? now(), ...failureOf({ ok: false, error, ...(options.code === undefined ? {} : { code: options.code }) }) } }),
});

const REQUEST_ACTIONS: readonly string[] = [SERVICE_HELLO, SERVICE_POSSIBLE_REQUEST, SERVICE_JOIN_REQUEST];

/**
 * Answer one HTTP request to a service: the preflight, a message of the protocol, or a failure of the carriage.
 * Every refusal of a message is answered with HTTP 200 in the shape of the answer to it; a network the service does
 * not serve is refused with `wrong-network`, another version with `version`. What the handlers return is checked
 * with the parsers a wallet uses before it is sent. The service keeps nothing between messages; the same `id` sent
 * twice is answered twice.
 */
export const answerServiceRequest = async (request: ServiceHttpRequest, networks: ServiceNetworks, options: { now?: () => number } = {}): Promise<ServiceHttpAnswer> => {
  const time = options.now?.() ?? now();
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return { status: 204, headers: { ...SERVICE_CORS_HEADERS }, body: '' };
  if (method !== 'POST') return serviceCarriageFailure(405, `A service takes POST only.`, { time });
  const raw = request.body ?? '';
  const size = typeof raw === 'string' ? serviceByteLength(raw) : raw.length;
  if (size > SERVICE_LIMITS.requestBytes) return serviceCarriageFailure(413, `The message is larger than the ${SERVICE_LIMITS.requestBytes} bytes a service takes.`, { code: 'too-large', time });
  let text: string;
  try {
    text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return serviceCarriageFailure(400, 'The body is not text.', { time });
  }
  let message: unknown;
  try {
    message = decodeServiceBody(text);
  } catch (error) {
    return serviceCarriageFailure(400, (error as Error).message, { time });
  }
  const fields = message as Record<string, unknown>;
  const action = fields['action'];
  if (typeof action !== 'string' || !REQUEST_ACTIONS.includes(action) || !isText(fields['id'], ID_LENGTH) || !isText(fields['network'], NAME_LENGTH)) {
    return serviceCarriageFailure(400, `The body is not a message a wallet sends in ${XO_SERVICE}.`, { time });
  }
  const envelope: ServiceEnvelopeFields = { network: fields['network'], id: fields['id'], time };
  const answer = (outcome: ServiceFailure | ServiceHelloOutcome | ServicePossibleOutcome | ServiceJoinOutcome): ServiceAnswer => {
    if (action === SERVICE_HELLO) return buildServiceHelloAnswer(envelope, outcome as ServiceHelloOutcome);
    if (action === SERVICE_POSSIBLE_REQUEST) return buildServicePossible(envelope, outcome as ServicePossibleOutcome);
    return buildServiceJoinResult(envelope, outcome as ServiceJoinOutcome);
  };
  const send = (built: ServiceAnswer): ServiceHttpAnswer => {
    const body = encodeServiceBody(built);
    if (serviceByteLength(body) > SERVICE_LIMITS.answerBytes) return serviceCarriageFailure(500, 'The service\'s answer is larger than a wallet reads.', { code: 'too-large', time });
    return { status: 200, headers: answerHeaders(), body };
  };
  // In the order a parser reads: the version first, then the network, then what the message holds.
  const handlers = Object.hasOwn(networks, envelope.network) ? networks[envelope.network] : undefined;
  if (fields['version'] === XO_SERVICE_VERSION && handlers === undefined) {
    return send(answer({ ok: false, error: `This service does not serve ${envelope.network.slice(0, 40)}.`, code: 'wrong-network' }));
  }
  let parsed: ServiceRequest;
  try {
    parsed = parseServiceRequest(message, { network: envelope.network });
  } catch (error) {
    return send(answer(error instanceof ServiceProtocolError ? { ok: false, error: error.message, ...(error.code === undefined ? {} : { code: error.code }) } : { ok: false, error: 'The message cannot be read.' }));
  }
  if (handlers === undefined) return send(answer({ ok: false, error: `This service does not serve ${envelope.network.slice(0, 40)}.`, code: 'wrong-network' }));
  let outcome: ServiceHelloOutcome | ServicePossibleOutcome | ServiceJoinOutcome;
  try {
    if (parsed.action === SERVICE_HELLO) outcome = await handlers.hello(parsed);
    else if (parsed.action === SERVICE_POSSIBLE_REQUEST) outcome = await handlers.possible(parsed);
    else outcome = await handlers.join(parsed);
  } catch {
    return serviceCarriageFailure(500, 'The service failed to answer.', { time });
  }
  try {
    return send(answer(outcome));
  } catch {
    return serviceCarriageFailure(500, 'The service made an answer the protocol does not allow.', { time });
  }
};
