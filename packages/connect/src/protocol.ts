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
export const XO_EXTENSION_VERSION = 1;

export const ACTION_REQUEST = 'xo_action_request';
export const ACTION_RESPONSE = 'xo_action_response';
export const INVITATION_UPDATE = 'xo_invitation_update';
export const ACTION_RESULT = 'xo_action_result';
export const POSITIONS_REQUEST = 'xo_positions_request';
export const POSITIONS = 'xo_positions';

/**
 * A template as a request names it: by its XO identifier and by the SHA-256 of its text, so that both sides
 * mean the same bytes. The recovery declaration that belongs to it is named by the hash of its text.
 */
export interface TemplateName {
  identifier: string;
  contentHash: string;
  declaration?: string;
}

/** The texts a request names: the template, its recovery declaration, and any file the declaration refers to. */
export interface TemplateTexts {
  template: string;
  declaration?: string;
  references?: string[];
}

/**
 * What a wallet puts under `xo_v1` in the session's extensions. It names no template: a list of what the
 * user trusts would tell each application which others the user deals with.
 */
export interface XoAdvertisement {
  version: number;
  network: string;
  /** The recovery profiles the wallet reads, such as `recoverable-app-v1`. */
  profiles: string[];
  /** The kinds of output the wallet fills with an address of its own: `receive`, `change`, `return`, `lasting`. */
  bindings: string[];
}

export type ParameterValue = string | number;

interface Envelope {
  /** Unix seconds. */
  time: number;
}

/** What an application asks for: an action of its template. */
export interface ActionDetails {
  template: TemplateName;
  /** The texts the request names. Sent when the wallet has answered that it does not have the template. */
  definition?: TemplateTexts;
  /** The action of the template, and the role the wallet is to take in it. */
  templateAction: string;
  role: string;
  variables: Record<string, ParameterValue>;
  /** Variables the wallet fills with a locking script of its own: variable name to one of the wallet's kinds. */
  bindings?: Record<string, string>;
  /** The variable the wallet fills with the category of the tokens the action creates. The wallet supplies the coin that defines it. */
  creates?: string;
  /** The categories of the wallet's tokens the action spends. */
  spends?: string[];
}

export interface ActionRequest extends Envelope, ActionDetails {
  action: typeof ACTION_REQUEST;
  /** Pairs the wallet's response with the request within a session. */
  sequence: number;
  /** Chosen by the application. Within one pairing, the same identifier is the same request, however often it arrives. */
  id: string;
}

/** Whether the wallet took the request on. A refusal is final for that identifier, except when the wallet asks for the template. */
export interface ActionResponse extends Envelope {
  action: typeof ACTION_RESPONSE;
  sequence: number;
  id: string;
  accepted: boolean;
  reason?: string;
  /** The wallet does not have the template the request names. The same request, sent again with the texts, is taken up. */
  templateNeeded?: boolean;
}

/** Progress of an accepted request. */
export interface InvitationUpdate extends Envelope {
  action: typeof INVITATION_UPDATE;
  id: string;
  /** `approved`: the user agreed. `recorded`: the backup holds the template. `sent`: the transaction is on the network. */
  stage: 'approved' | 'recorded' | 'sent';
}

export interface ActionResult extends Envelope {
  action: typeof ACTION_RESULT;
  id: string;
  ok: boolean;
  /** For `ok`: the transaction, and the tokens the wallet received. */
  result?: Record<string, unknown>;
  error?: string;
}

/** Ask which tokens of a template the wallet holds. Answered without asking the user, and only for a template the user trusted in a session with this application. */
export interface PositionsRequest extends Envelope {
  action: typeof POSITIONS_REQUEST;
  id: string;
  /** The template's identifier. */
  template: string;
}

/** A token of the application's template that the wallet holds, and where its position stands on chain. */
export interface ReportedPosition {
  /** The token's category and commitment, as hex. */
  category: string;
  commitment: string;
  /** The authority entry of the template's declaration the token stands for. */
  authority: string;
  /** `open`, `closed` when the position is no longer there, `incomplete` when it cannot be worked out, `ambiguous`. */
  status: string;
  /** What the position holds now. */
  satoshis: string;
  /** The position's locking bytecode, as hex, when it can be worked out. */
  lockingBytecode?: string;
  /** The actions the template offers the token's holder. */
  actions: string[];
}

export interface PositionsResponse extends Envelope {
  action: typeof POSITIONS;
  id: string;
  /** Whether the user trusted the template in a session with this application. If not, nothing is reported whatever the wallet holds. */
  trusted: boolean;
  positions: ReportedPosition[];
  /** Set if the wallet could not read the chain just now. The list is then not to be taken as empty. */
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
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isTemplateName = (value: unknown): value is TemplateName =>
  isObject(value) && isHash(value['identifier']) && isHash(value['contentHash']) && (value['declaration'] === undefined || isHash(value['declaration']));

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
  const { profiles, bindings } = offered;
  if (!isText(offered['network']) || !Array.isArray(profiles) || !Array.isArray(bindings)) throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  return {
    version: offered['version'],
    network: offered['network'],
    profiles: profiles.filter((item): item is string => isText(item, 60)),
    bindings: bindings.filter((item): item is string => isText(item, 40)),
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

/** The largest text a request may carry: a template with its compiled contracts. */
const LARGEST_TEXT = 400_000;
const isLongText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= LARGEST_TEXT;

const readTexts = (definition: unknown): TemplateTexts => {
  if (!isObject(definition) || !isLongText(definition['template'])) throw new ProtocolError('The template sent with the request cannot be read.');
  const { declaration, references } = definition;
  if (declaration !== undefined && !isLongText(declaration)) throw new ProtocolError('The recovery declaration sent with the request cannot be read.');
  if (references !== undefined && (!Array.isArray(references) || references.length > 8 || !references.every(isLongText))) throw new ProtocolError('The files sent with the request cannot be read.');
  return { template: definition['template'], ...(declaration === undefined ? {} : { declaration }), ...(references === undefined ? {} : { references: references as string[] }) };
};

/**
 * Check a message that claims to be a request.
 * @throws ProtocolError if it is not one this version understands
 */
export const parseRequest = (message: unknown): ActionRequest => {
  if (!isObject(message) || message['action'] !== ACTION_REQUEST) throw new ProtocolError('Not a request.');
  const { time, sequence, id, template, definition, templateAction, role, variables, bindings, creates, spends } = message;
  if (typeof time !== 'number' || typeof sequence !== 'number' || !isText(id, 80) || !isText(templateAction, 80) || !isText(role, 80)) {
    throw new ProtocolError('The request is missing something or has a field of the wrong kind.');
  }
  if (!isTemplateName(template)) throw new ProtocolError('The request does not name its template by identifier and content hash.');
  if (creates !== undefined && !isText(creates, 80)) throw new ProtocolError('The request names the variable of a new token in a form this wallet does not accept.');
  if (spends !== undefined && (!Array.isArray(spends) || spends.length > 8 || !spends.every(isHash))) throw new ProtocolError('The request names the tokens it spends in a form this wallet does not accept.');
  const bound = bindings === undefined ? undefined : readValues(bindings, 'bindings');
  if (bound !== undefined && Object.values(bound).some((source) => typeof source !== 'string')) throw new ProtocolError('The request\'s bindings are not names.');
  return {
    action: ACTION_REQUEST,
    time,
    sequence,
    id,
    template: { identifier: template.identifier, contentHash: template.contentHash, ...(template.declaration === undefined ? {} : { declaration: template.declaration }) },
    ...(definition === undefined ? {} : { definition: readTexts(definition) }),
    templateAction,
    role,
    variables: readValues(variables, 'values'),
    ...(bound === undefined ? {} : { bindings: bound as Record<string, string> }),
    ...(creates === undefined ? {} : { creates }),
    ...(spends === undefined ? {} : { spends: spends as string[] }),
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
  a.template.declaration === b.template.declaration &&
  a.templateAction === b.templateAction &&
  a.role === b.role &&
  a.creates === b.creates &&
  (a.spends ?? []).join() === (b.spends ?? []).join() &&
  sameValues(a.variables, b.variables) &&
  sameValues(a.bindings, b.bindings);

/** The standard WizardConnect request for signatures on a transaction the application built. */
export const SIGN_TRANSACTION_REQUEST = 'sign_transaction_request';
export const SIGN_TRANSACTION_RESPONSE = 'sign_transaction_response';

/** Why this kind of wallet signs no transaction an application builds. */
export const NO_PLAIN_SIGNING =
  'This wallet does not sign a transaction that an application built. Its coins are at addresses that only the wallet\'s own code spends from, so it offers no keys in a session. Ask it for an action of your template instead (xo_v1).';

/**
 * The wallet's answer to a standard request for signatures: a refusal with the reason (proposal section 14.1).
 * @returns `undefined` for any other message
 */
export const refusalOfStandardRequest = (message: unknown, now: number): { action: typeof SIGN_TRANSACTION_RESPONSE; time: number; sequence: number; signedTransaction: string; error: string } | undefined => {
  if (!isObject(message) || message['action'] !== SIGN_TRANSACTION_REQUEST) return undefined;
  return { action: SIGN_TRANSACTION_RESPONSE, time: now, sequence: typeof message['sequence'] === 'number' ? message['sequence'] : 0, signedTransaction: '', error: NO_PLAIN_SIGNING };
};

/** Where messages go and come from; a WizardConnect session in the applications, a pair of queues in tests. */
export interface Channel {
  send(message: XoMessage): Promise<void>;
  /** Called for every message of this extension that arrives. Returns a function that stops the calls. */
  onMessage(handler: (message: unknown) => void): () => void;
  /** For numbering requests. */
  nextSequence(): number;
}
