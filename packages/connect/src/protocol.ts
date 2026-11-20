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
/**
 * The version of the requests (proposal section 14.2). An application needs nothing but its XO template: a request
 * says which position it is about and whether it spends the token, names the application's coins by outpoint, and
 * may name the application's page; a positions request is answered from the wallet's records.
 */
export const XO_EXTENSION_VERSION = 2;

export const ACTION_REQUEST = 'xo_action_request';
export const ACTION_RESPONSE = 'xo_action_response';
export const INVITATION_UPDATE = 'xo_invitation_update';
export const ACTION_RESULT = 'xo_action_result';
export const POSITIONS_REQUEST = 'xo_positions_request';
export const POSITIONS = 'xo_positions';
export const TEMPLATE_OFFER = 'xo_template_offer';
export const TEMPLATE_ANSWER = 'xo_template_answer';

/**
 * A template as a request names it: by its XO identifier and by the SHA-256 of its text, so that both sides
 * mean the same bytes.
 */
export interface TemplateName {
  identifier: string;
  contentHash: string;
}

/** The text a request names: the template, as its author wrote it. */
export interface TemplateTexts {
  template: string;
}

/**
 * What a wallet puts under `xo_v1` in the session's extensions. It names no template: a list of what the
 * user trusts would tell each application which others the user deals with.
 */
export interface XoAdvertisement {
  version: number;
  network: string;
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
  /**
   * Which position the action is about, by the category of the wallet's token, and whether the action spends that
   * token. Paying into a position is about its token and does not spend it.
   */
  about?: { category: string; spent: boolean };
  /** The address of the application's page, which the wallet keeps in the position's record. */
  page?: string;
  /**
   * The application's own coins the action is to spend, by template input, as `<transaction id>:<output index>`:
   * which of the contracts its users share the application chose, and, for a position at a script many users
   * share, the coin that is the position. The wallet reads each from the chain and finds which of the template's
   * scripts the coin is at.
   */
  inputs?: Record<string, string>;
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

/**
 * Why an action was not carried out, in a form an application can act on, beside the words of `error`. The same for
 * every application.
 * - `inputs-spent`: the network refused the transaction because one of the coins it spends was spent by another
 *   transaction first, or is no longer there. Nothing was sent. The wallet's own coins in it are free again; the
 *   application may read its coins again and ask anew.
 */
export const ACTION_ERROR_CODES = ['inputs-spent'] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];
export const isActionErrorCode = (value: unknown): value is ActionErrorCode => (ACTION_ERROR_CODES as readonly unknown[]).includes(value);

export interface ActionResult extends Envelope {
  action: typeof ACTION_RESULT;
  id: string;
  ok: boolean;
  /** For `ok`: the transaction, and the tokens the wallet received. */
  result?: Record<string, unknown>;
  error?: string;
  /** For a failure the application can act on: why, as one of {@link ACTION_ERROR_CODES}. An application that does not know the code reads `error`. */
  code?: ActionErrorCode;
}

/** Ask which tokens of a template the wallet holds. Answered without asking the user, and only for a template the user trusted in a session with this application. */
export interface PositionsRequest extends Envelope {
  action: typeof POSITIONS_REQUEST;
  id: string;
  /** The template's identifier. */
  template: string;
  /** The version of the requests the application speaks. */
  version?: number;
}

/**
 * A token of the application's template that the wallet holds and that a record of the wallet's ties to the
 * template (proposal section 14.2). A token without a record is not reported.
 */
export interface RecordedPositionReport {
  /** The NFT, as hex. */
  category: string;
  commitment: string;
  capability: string;
  /** The value of the coin that holds the token, in satoshis: some contracts require an action to repeat it. */
  satoshis: string;
  /**
   * - `open`, `closed`: a position at a script of its own, which the chain confirms, and whose script holds coins
   *   or holds nothing.
   * - `unconfirmed`: a position at a script of its own that the chain does not confirm.
   * - `held`: a position at a script many users share. The wallet holds the token; whether the position is open
   *   is the application's to find out.
   */
  status: 'open' | 'closed' | 'unconfirmed' | 'held';
  /** For a position at a script of its own: the template's locking script, and the values it was made with. */
  lockingScript?: string;
  variables?: Record<string, string>;
}

export interface PositionsResponse extends Envelope {
  action: typeof POSITIONS;
  id: string;
  /** Whether the user trusted the template in a session with this application. If not, nothing is reported whatever the wallet holds. */
  trusted: boolean;
  version: number;
  positions: RecordedPositionReport[];
  /** Set if the wallet could not read the chain just now. The list is then not to be taken as empty. */
  error?: string;
}

/**
 * An application presents its template without asking for an action: for a wallet that holds tokens of the
 * template and has never used the application. The wallet shows the template to the user as it does with a
 * first action, and answers when the user has decided.
 */
export interface TemplateOffer extends Envelope {
  action: typeof TEMPLATE_OFFER;
  id: string;
  template: TemplateName;
  definition: TemplateTexts;
}

export interface TemplateAnswer extends Envelope {
  action: typeof TEMPLATE_ANSWER;
  id: string;
  /** The user trusts the template in a session with this application; a positions request is answered from now on. */
  trusted: boolean;
  reason?: string;
}

export type XoMessage = ActionRequest | ActionResponse | InvitationUpdate | ActionResult | PositionsRequest | PositionsResponse | TemplateOffer | TemplateAnswer;

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, maximum = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isTemplateName = (value: unknown): value is TemplateName => isObject(value) && isHash(value['identifier']) && isHash(value['contentHash']);

/**
 * Read a wallet's advertisement from a session's extensions: the version of the requests, the network and the
 * kinds of output the wallet fills.
 * @returns `undefined` if the wallet does not offer XO requests
 * @throws ProtocolError if it offers another version than this software's
 */
export const readAdvertisement = (extensions: unknown): XoAdvertisement | undefined => {
  if (!isObject(extensions) || extensions[XO_EXTENSION] === undefined) return undefined;
  const offered = extensions[XO_EXTENSION];
  if (!isObject(offered) || typeof offered['version'] !== 'number') throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  if (offered['version'] !== XO_EXTENSION_VERSION) {
    throw new ProtocolError(`The wallet speaks version ${offered['version']} of XO requests; this application speaks version ${XO_EXTENSION_VERSION}. Update the wallet and connect again.`);
  }
  const { bindings } = offered;
  if (!isText(offered['network']) || !Array.isArray(bindings)) throw new ProtocolError('The wallet\'s XO advertisement cannot be read.');
  return {
    version: offered['version'],
    network: offered['network'],
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

/** The template a request or an offer sends. Anything else beside it is not taken. */
const readTexts = (definition: unknown): TemplateTexts => {
  if (!isObject(definition) || !isLongText(definition['template'])) throw new ProtocolError('The template sent with the request cannot be read.');
  return { template: definition['template'] };
};

/**
 * Check a message that claims to be a request.
 * @throws ProtocolError if it is not one this version understands
 */
export const parseRequest = (message: unknown): ActionRequest => {
  if (!isObject(message) || message['action'] !== ACTION_REQUEST) throw new ProtocolError('Not a request.');
  const { time, sequence, id, template, definition, templateAction, role, variables, bindings, creates, inputs, about, page } = message;
  if (typeof time !== 'number' || typeof sequence !== 'number' || !isText(id, 80) || !isText(templateAction, 80) || !isText(role, 80)) {
    throw new ProtocolError('The request is missing something or has a field of the wrong kind.');
  }
  if (!isTemplateName(template)) throw new ProtocolError('The request does not name its template by identifier and content hash.');
  if (creates !== undefined && !isText(creates, 80)) throw new ProtocolError('The request names the variable of a new token in a form this wallet does not accept.');
  const bound = bindings === undefined ? undefined : readValues(bindings, 'bindings');
  const named = inputs === undefined ? undefined : readValues(inputs, 'inputs');
  if (named !== undefined && (Object.keys(named).length > 16 || !Object.values(named).every((outpoint) => typeof outpoint === 'string' && /^[0-9a-f]{64}:\d{1,5}$/.test(outpoint)))) {
    throw new ProtocolError('The request names coins in a form this wallet does not accept.');
  }
  if (bound !== undefined && Object.values(bound).some((source) => typeof source !== 'string')) throw new ProtocolError('The request\'s bindings are not names.');
  if (about !== undefined && (!isObject(about) || !isHash(about['category']) || typeof about['spent'] !== 'boolean')) throw new ProtocolError('The request names the position it is about in a form this wallet does not accept.');
  if (page !== undefined && (!isText(page, 400) || !/^https?:\/\/[^\s]+$/.test(page))) throw new ProtocolError('The request names the application\'s page in a form this wallet does not accept.');
  return {
    action: ACTION_REQUEST,
    time,
    sequence,
    id,
    template: { identifier: template.identifier, contentHash: template.contentHash },
    ...(definition === undefined ? {} : { definition: readTexts(definition) }),
    templateAction,
    role,
    variables: readValues(variables, 'values'),
    ...(bound === undefined ? {} : { bindings: bound as Record<string, string> }),
    ...(creates === undefined ? {} : { creates }),
    ...(named === undefined ? {} : { inputs: named as Record<string, string> }),
    ...(about === undefined ? {} : { about: { category: (about as { category: string }).category, spent: (about as { spent: boolean }).spent } }),
    ...(page === undefined ? {} : { page: page as string }),
  };
};

/**
 * Check a message that claims to offer a template.
 * @throws ProtocolError if it is not one this version understands
 */
export const parseOffer = (message: unknown): TemplateOffer => {
  if (!isObject(message) || message['action'] !== TEMPLATE_OFFER) throw new ProtocolError('Not an offer of a template.');
  const { time, id, template, definition } = message;
  if (typeof time !== 'number' || !isText(id, 80)) throw new ProtocolError('The offer is missing something or has a field of the wrong kind.');
  if (!isTemplateName(template)) throw new ProtocolError('The offer does not name its template by identifier and content hash.');
  return {
    action: TEMPLATE_OFFER,
    time,
    id,
    template: { identifier: template.identifier, contentHash: template.contentHash },
    definition: readTexts(definition),
  };
};

export const isXoMessage = (message: unknown): message is XoMessage =>
  isObject(message) && [ACTION_REQUEST, ACTION_RESPONSE, INVITATION_UPDATE, ACTION_RESULT, POSITIONS_REQUEST, POSITIONS, TEMPLATE_OFFER, TEMPLATE_ANSWER].includes(message['action'] as string);

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
  a.creates === b.creates &&
  a.about?.category === b.about?.category &&
  a.about?.spent === b.about?.spent &&
  a.page === b.page &&
  sameValues(a.variables, b.variables) &&
  sameValues(a.bindings, b.bindings) &&
  sameValues(a.inputs, b.inputs);

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
