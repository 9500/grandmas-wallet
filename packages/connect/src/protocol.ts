/**
 * XO requests between an application and a wallet.
 *
 * An application does not build transactions for this wallet and does not
 * see invitations. It names a template the wallet has reviewed, one of the
 * operations the wallet offers for it, and the values the user chose; the
 * wallet shows the user what that means, and does the rest itself: records,
 * invitation, signing, sending.
 *
 * The messages travel as custom actions of a WizardConnect session. A wallet
 * that speaks them says so in the session's `extensions` under `xo_v1`.
 */

export const XO_EXTENSION = 'xo_v1';
export const XO_EXTENSION_VERSION = 1;

export const ACTION_REQUEST = 'xo_action_request';
export const ACTION_RESPONSE = 'xo_action_response';
export const INVITATION_UPDATE = 'xo_invitation_update';
export const ACTION_RESULT = 'xo_action_result';

/** A template the wallet will act on for a connected application, and what it offers to do with it. */
export interface OfferedTemplate {
  /** The template's XO identifier. */
  identifier: string;
  /** SHA-256 of the template's canonical encoding, so that both sides mean the same bytes. */
  contentHash: string;
  operations: string[];
}

/** What a wallet puts under `xo_v1` in the session's extensions. */
export interface XoAdvertisement {
  version: number;
  network: string;
  /** Version of the owner-approval interface the wallet's positions use. */
  interfaceVersion: number;
  templates: OfferedTemplate[];
}

export type ParameterValue = string | number;

interface Envelope {
  /** Unix seconds. */
  time: number;
}

export interface ActionRequest extends Envelope {
  action: typeof ACTION_REQUEST;
  /** Pairs the wallet's response with the request within a session. */
  sequence: number;
  /** Chosen by the application. The same identifier is the same request, however often it arrives. */
  id: string;
  template: string;
  operation: string;
  parameters: Record<string, ParameterValue>;
}

/** Whether the wallet took the request on. A refusal is final for that identifier. */
export interface ActionResponse extends Envelope {
  action: typeof ACTION_RESPONSE;
  sequence: number;
  id: string;
  accepted: boolean;
  reason?: string;
}

/** Progress of an accepted request. */
export interface InvitationUpdate extends Envelope {
  action: typeof INVITATION_UPDATE;
  id: string;
  /** `approved`: the user agreed. `recorded`: the backup holds the record. `sent`: the transaction is on the network. */
  stage: 'approved' | 'recorded' | 'sent';
}

export interface ActionResult extends Envelope {
  action: typeof ACTION_RESULT;
  id: string;
  ok: boolean;
  /** For `ok`: what the operation produced. */
  result?: Record<string, unknown>;
  error?: string;
}

export type XoMessage = ActionRequest | ActionResponse | InvitationUpdate | ActionResult;

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, maximum = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum;

/**
 * Read a wallet's advertisement from a session's extensions.
 * @returns `undefined` if the wallet does not offer XO requests
 * @throws ProtocolError if it offers a version this software does not know
 */
export const readAdvertisement = (extensions: unknown): XoAdvertisement | undefined => {
  if (!isObject(extensions) || extensions[XO_EXTENSION] === undefined) return undefined;
  const offered = extensions[XO_EXTENSION];
  if (!isObject(offered) || typeof offered['version'] !== 'number') throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  if (offered['version'] !== XO_EXTENSION_VERSION) {
    throw new ProtocolError(`The wallet speaks version ${offered['version']} of XO requests; this application knows version ${XO_EXTENSION_VERSION}.`);
  }
  const templates = offered['templates'];
  if (!isText(offered['network']) || typeof offered['interfaceVersion'] !== 'number' || !Array.isArray(templates)) {
    throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  }
  return {
    version: offered['version'],
    network: offered['network'],
    interfaceVersion: offered['interfaceVersion'],
    templates: templates.flatMap((template: unknown) =>
      isObject(template) && isText(template['identifier']) && isText(template['contentHash']) && Array.isArray(template['operations'])
        ? [{ identifier: template['identifier'], contentHash: template['contentHash'], operations: template['operations'].filter((item): item is string => isText(item)) }]
        : [],
    ),
  };
};

/**
 * Check a message that claims to be a request.
 * @throws ProtocolError if it is not one this version understands
 */
export const parseRequest = (message: unknown): ActionRequest => {
  if (!isObject(message) || message['action'] !== ACTION_REQUEST) throw new ProtocolError('Not a request.');
  const { time, sequence, id, template, operation, parameters } = message;
  if (typeof time !== 'number' || typeof sequence !== 'number' || !isText(id, 80) || !isText(template) || !isText(operation, 40) || !isObject(parameters)) {
    throw new ProtocolError('The request is missing something or has a field of the wrong kind.');
  }
  const values: Record<string, ParameterValue> = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new ProtocolError(`The request's value "${name}" is of a kind this wallet does not accept.`);
    if (typeof value === 'string' && value.length > 400) throw new ProtocolError(`The request's value "${name}" is too long.`);
    values[name] = value;
  }
  return { action: ACTION_REQUEST, time, sequence, id, template, operation, parameters: values };
};

export const isXoMessage = (message: unknown): message is XoMessage =>
  isObject(message) && [ACTION_REQUEST, ACTION_RESPONSE, INVITATION_UPDATE, ACTION_RESULT].includes(message['action'] as string);

/** Two requests are the same request only if everything the user would be shown is the same. */
export const sameRequest = (a: Pick<ActionRequest, 'template' | 'operation' | 'parameters'>, b: Pick<ActionRequest, 'template' | 'operation' | 'parameters'>): boolean => {
  const names = Object.keys(a.parameters).sort();
  return (
    a.template === b.template &&
    a.operation === b.operation &&
    names.length === Object.keys(b.parameters).length &&
    names.every((name) => a.parameters[name] === b.parameters[name])
  );
};

/** Where messages go and come from; a WizardConnect session in the applications, a pair of queues in tests. */
export interface Channel {
  send(message: XoMessage): Promise<void>;
  /** Called for every message of this extension that arrives. Returns a function that stops the calls. */
  onMessage(handler: (message: unknown) => void): () => void;
  /** For numbering requests. */
  nextSequence(): number;
}
