/**
 * XO requests between an application and a wallet.
 *
 * An application does not build transactions for this kind of wallet and
 * does not see invitations. It presents its XO template and asks for one of
 * the template's actions with the values the user chose. The wallet decides
 * whether it trusts the template, shows the user what the action means in
 * the template's own words, and does the rest itself: records, invitation,
 * signing, sending.
 *
 * The wallet knows nothing about any application beforehand. What it offers
 * is the same for all of them: to carry out actions of a template, to supply
 * its own values where the application asks for them, and to say which
 * positions of a template it holds.
 *
 * The messages travel as custom actions of a WizardConnect session. A wallet
 * that speaks them says so in the session's `extensions` under `xo_v1`.
 */

export const XO_EXTENSION = 'xo_v1';
export const XO_EXTENSION_VERSION = 2;

export const ACTION_REQUEST = 'xo_action_request';
export const ACTION_RESPONSE = 'xo_action_response';
export const INVITATION_UPDATE = 'xo_invitation_update';
export const ACTION_RESULT = 'xo_action_result';
export const POSITIONS_REQUEST = 'xo_positions_request';
export const POSITIONS = 'xo_positions';

/** A template named by its XO identifier and by the SHA-256 of its canonical encoding, so that both sides mean the same bytes. */
export interface TemplateName {
  identifier: string;
  contentHash: string;
}

/** What a wallet puts under `xo_v1` in the session's extensions. */
export interface XoAdvertisement {
  version: number;
  network: string;
  /** Version of the owner-approval interface the wallet's positions use. */
  interfaceVersion: number;
  /** Values the wallet can fill into a template's variables when asked, such as `identity`. */
  bindings: string[];
  /** Templates the wallet already trusts. An application need not send those again. */
  templates: TemplateName[];
}

export type ParameterValue = string | number;

interface Envelope {
  /** Unix seconds. */
  time: number;
}

/** What an application asks for: an action of its template. */
export interface ActionDetails {
  template: TemplateName;
  /**
   * The template itself. A wallet that does not yet trust the template needs it, and asks the user
   * whether to trust and remember it.
   */
  definition?: unknown;
  /** The action of the template, and the role the wallet is to take in it. */
  templateAction: string;
  role: string;
  variables: Record<string, ParameterValue>;
  /** Variables the wallet is to fill in itself: variable name to one of the wallet's advertised bindings. */
  bindings?: Record<string, string>;
  /** A position of the wallet that the action spends, as named in the wallet's list of positions. */
  position?: string;
  /** What the user calls a position the action creates. */
  label?: string;
}

export interface ActionRequest extends Envelope, ActionDetails {
  action: typeof ACTION_REQUEST;
  /** Pairs the wallet's response with the request within a session. */
  sequence: number;
  /** Chosen by the application. The same identifier is the same request, however often it arrives. */
  id: string;
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
  /** For `ok`: what the action produced. */
  result?: Record<string, unknown>;
  error?: string;
}

/** Ask which positions of a template the wallet holds. Answered without asking the user, and only for a template the wallet trusts. */
export interface PositionsRequest extends Envelope {
  action: typeof POSITIONS_REQUEST;
  id: string;
  /** The template's identifier. */
  template: string;
}

/** A position as the wallet reports it to the application whose template made it. */
export interface ReportedPosition {
  position: string;
  label: string;
  /** The template output the position is. */
  output: string;
  /** The values the position was made with. */
  variables: Record<string, ParameterValue>;
  /** What the position holds now. */
  satoshis: string;
}

export interface PositionsResponse extends Envelope {
  action: typeof POSITIONS;
  id: string;
  /** Whether the wallet trusts the template asked about. If not, it reports no positions whatever it holds. */
  trusted: boolean;
  positions: ReportedPosition[];
  /** Set if the wallet could not read its positions just now. The list is then not to be taken as empty. */
  error?: string;
}

export type XoMessage = ActionRequest | ActionResponse | InvitationUpdate | ActionResult | PositionsRequest | PositionsResponse;

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, maximum = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const isTemplateName = (value: unknown): value is TemplateName => isObject(value) && isText(value['identifier']) && isText(value['contentHash']);

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
  const { templates, bindings } = offered;
  if (!isText(offered['network']) || typeof offered['interfaceVersion'] !== 'number' || !Array.isArray(templates) || !Array.isArray(bindings)) {
    throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  }
  return {
    version: offered['version'],
    network: offered['network'],
    interfaceVersion: offered['interfaceVersion'],
    bindings: bindings.filter((item): item is string => isText(item, 40)),
    templates: templates.flatMap((template: unknown) => (isTemplateName(template) ? [{ identifier: template.identifier, contentHash: template.contentHash }] : [])),
  };
};

const readValues = (values: unknown, what: string): Record<string, ParameterValue> => {
  if (!isObject(values)) throw new ProtocolError(`The request's ${what} are missing.`);
  const read: Record<string, ParameterValue> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new ProtocolError(`The request's value "${name}" is of a kind this wallet does not accept.`);
    if (typeof value === 'string' && value.length > 400) throw new ProtocolError(`The request's value "${name}" is too long.`);
    read[name] = value;
  }
  return read;
};

/**
 * Check a message that claims to be a request.
 * @throws ProtocolError if it is not one this version understands
 */
export const parseRequest = (message: unknown): ActionRequest => {
  if (!isObject(message) || message['action'] !== ACTION_REQUEST) throw new ProtocolError('Not a request.');
  const { time, sequence, id, template, definition, templateAction, role, variables, bindings, position, label } = message;
  if (typeof time !== 'number' || typeof sequence !== 'number' || !isText(id, 80) || !isTemplateName(template) || !isText(templateAction, 80) || !isText(role, 80)) {
    throw new ProtocolError('The request is missing something or has a field of the wrong kind.');
  }
  if (definition !== undefined && !isObject(definition)) throw new ProtocolError('The template sent with the request cannot be read.');
  if (position !== undefined && !isText(position, 120)) throw new ProtocolError('The request names a position in a form this wallet does not accept.');
  if (label !== undefined && (typeof label !== 'string' || label.length > 80)) throw new ProtocolError('The request\'s label is too long.');
  const bound = bindings === undefined ? undefined : readValues(bindings, 'bindings');
  if (bound !== undefined && Object.values(bound).some((source) => typeof source !== 'string')) throw new ProtocolError('The request\'s bindings are not names.');
  return {
    action: ACTION_REQUEST,
    time,
    sequence,
    id,
    template: { identifier: template.identifier, contentHash: template.contentHash },
    ...(definition === undefined ? {} : { definition }),
    templateAction,
    role,
    variables: readValues(variables, 'values'),
    ...(bound === undefined ? {} : { bindings: bound as Record<string, string> }),
    ...(position === undefined ? {} : { position }),
    ...(label === undefined || label === '' ? {} : { label }),
  };
};

export const isXoMessage = (message: unknown): message is XoMessage =>
  isObject(message) && [ACTION_REQUEST, ACTION_RESPONSE, INVITATION_UPDATE, ACTION_RESULT, POSITIONS_REQUEST, POSITIONS].includes(message['action'] as string);

const sameValues = (a: Record<string, ParameterValue> = {}, b: Record<string, ParameterValue> = {}): boolean => {
  const names = Object.keys(a).sort();
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
};

/** Two requests are the same request only if everything the user would be shown is the same. */
export const sameRequest = (a: ActionDetails, b: ActionDetails): boolean =>
  a.template.identifier === b.template.identifier &&
  a.template.contentHash === b.template.contentHash &&
  a.templateAction === b.templateAction &&
  a.role === b.role &&
  a.position === b.position &&
  a.label === b.label &&
  sameValues(a.variables, b.variables) &&
  sameValues(a.bindings, b.bindings);

/** Where messages go and come from; a WizardConnect session in the applications, a pair of queues in tests. */
export interface Channel {
  send(message: XoMessage): Promise<void>;
  /** Called for every message of this extension that arrives. Returns a function that stops the calls. */
  onMessage(handler: (message: unknown) => void): () => void;
  /** For numbering requests. */
  nextSequence(): number;
}
