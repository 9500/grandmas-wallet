import { type ReadTemplate, textHash } from '@grandmas-wallet/core';

/**
 * The recovery declaration of an application's template (proposal section 13.3): which outputs create
 * authority tokens, how the position each controls is found, what its holder can do, and which parts of
 * each action are the wallet's.
 *
 * Until XO's schema has a place for it, the declaration travels as a document beside the template. It names
 * its template by identifier and content hash, and is itself named by the hash of its text.
 */

export const RECOVERY_PROFILE = 'recoverable-app-v1';
export const RECOVERY_PROFILE_VERSION = 1;

/** The kinds of output an application leaves to the wallet (section 13.3). */
export const BINDING_KINDS = ['receive', 'change', 'return', 'lasting'] as const;
export type BindingKind = (typeof BINDING_KINDS)[number];

/**
 * Where the wallet takes a variable's value from when it works from a token and the chain:
 *
 * - `token.category`, `token.commitment`, `token.valueSatoshis`: the authority token the action is about;
 *   `token.inputIndex`: the number of the input that spends it
 * - `companion.commitment`: the companion coin a position was found through
 * - `position.commitment`, `position.valueSatoshis`: the position
 * - `input.<input>.category`, `.commitment`, `.tokenAmount`, `.valueSatoshis`: a coin of the application that
 *   the action spends as the template input `<input>`, read from the chain by the wallet
 *
 * A commitment can be read in part: `position.commitment[1..7]` is its bytes 1 to 6. A whole number is read
 * from bytes as scripts write numbers; from a part, as `OP_BIN2NUM` reads it (fixed-width fields).
 */
export type ValueSource = string;

const SOURCE = /^(?:token\.(?:category|inputIndex|valueSatoshis|commitment(?:\[\d{1,3}\.\.\d{1,3}\])?)|companion\.commitment(?:\[\d{1,3}\.\.\d{1,3}\])?|position\.(?:valueSatoshis|commitment(?:\[\d{1,3}\.\.\d{1,3}\])?)|input\.[A-Za-z0-9_]{1,80}\.(?:category|tokenAmount|valueSatoshis|commitment(?:\[\d{1,3}\.\.\d{1,3}\])?))$/;

/** A source, taken apart. */
export interface ReadSource {
  from: 'token' | 'companion' | 'position' | 'input';
  /** For `input`: the template input. */
  input?: string;
  field: 'category' | 'commitment' | 'inputIndex' | 'valueSatoshis' | 'tokenAmount';
  /** Bytes `start` up to `end`, of a commitment. */
  range?: { start: number; end: number };
}

export const readSource = (source: ValueSource): ReadSource => {
  const [path = '', range] = source.split('[');
  const parts = path.split('.');
  const from = parts[0] as ReadSource['from'];
  const input = from === 'input' ? parts[1] : undefined;
  const field = parts.at(-1) as ReadSource['field'];
  const bounds = range === undefined ? undefined : /^(\d+)\.\.(\d+)\]$/.exec(range);
  return { from, ...(input === undefined ? {} : { input }), field, ...(bounds === undefined || bounds === null ? {} : { range: { start: Number(bounds[1]), end: Number(bounds[2]) } }) };
};

/** A position whose address follows from the token alone. */
export interface DirectPosition {
  lockingScript: string;
  variables: Record<string, ValueSource>;
}

/**
 * A position found through a companion coin: an unspent coin at the companion script that carries the
 * token's category. The position is the output at the stated distance in the transaction that made the
 * companion. `genuine` says what the position's own script and token must be; a candidate that fails it is
 * not taken for the position.
 */
export interface CompanionPosition {
  /** With `commitment`, only a companion whose token has that commitment (hex) is a candidate. */
  companion: { lockingScript: string; variables?: Record<string, ValueSource>; tokenCategory: 'token.category'; commitment?: string };
  relative: number;
  genuine: { lockingScript: string; variables: Record<string, ValueSource>; tokenCategory?: string };
}

export interface AuthorityEntry {
  /** The template output that creates the token. */
  token: string;
  position: DirectPosition | CompanionPosition;
  /** The actions the token's holder can take on the position. */
  actions: string[];
  /** Template variables the wallet reads from the position to show what it holds, in the template's words. */
  state?: Record<string, ValueSource>;
}

/**
 * A coin of the application that an action spends besides the position: a contract every user of the
 * application shares, at a script the template gives. A page may name the coin; the wallet then checks that it
 * is unspent at that script and carries the token described. Without a page the wallet finds one itself.
 */
export interface ApplicationInput {
  lockingScript: string;
  /** The token the coin carries: its category (hex), its capability, its commitment (hex). What is left out may be anything. */
  token?: { category?: string; capability?: 'none' | 'mutable' | 'minting'; commitment?: string };
}

/** The wallet's parts of one action. */
export interface ActionEntry {
  /** The variable that receives the category of the tokens the action creates. The wallet supplies the coin that defines it. */
  creates?: string;
  /** The authority entry whose token the action spends. */
  spends?: string;
  /** The template input that each coin of the position is spent as. */
  position?: string;
  /** The template input that the companion coin the position was found through is spent as. */
  companion?: string;
  /** The application's other inputs, by template input. */
  inputs?: Record<string, ApplicationInput>;
  /**
   * Variables only the application works out, with arithmetic of its own. When the wallet carries the action
   * out by itself, from its list of tokens, it asks the user for every value it cannot fill, except these: an
   * action that needs one of them is offered only through the application.
   */
  fromApplication?: string[];
  /** Variables that hold a locking script of the wallet's, with the kind of each. */
  outputs?: Record<string, BindingKind>;
  /** Variables the wallet fills from the token and the chain. */
  variables?: Record<string, ValueSource>;
}

export interface RecoveryDeclaration {
  profile: string;
  version: number;
  template: { identifier: string; contentHash: string };
  /** Content hashes of other files the template or the declaration refers to. */
  references?: string[];
  authority: Record<string, AuthorityEntry>;
  actions: Record<string, ActionEntry>;
}

export interface ReadDeclaration {
  text: string;
  contentHash: string;
  declaration: RecoveryDeclaration;
}

export class DeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarationError';
  }
}

/** The profile or version is one this wallet does not know. Refused explicitly, never read as something else. */
export class UnknownProfileError extends DeclarationError {
  constructor(profile: unknown, version: unknown) {
    super(`The recovery declaration is of profile "${String(profile)}", version ${String(version)}. This wallet knows "${RECOVERY_PROFILE}", version ${RECOVERY_PROFILE_VERSION}, and reads no other.`);
    this.name = 'UnknownProfileError';
  }
}

const fail = (message: string): never => {
  throw new DeclarationError(message);
};
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const name = (value: unknown, what: string): string => (typeof value === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : fail(`The declaration's ${what} is not a name.`));
const isSource = (value: unknown): value is ValueSource => typeof value === 'string' && SOURCE.test(value);
const isHex = (value: unknown): value is string => typeof value === 'string' && /^([0-9a-f]{2})*$/.test(value) && value.length <= 256;

const sources = (value: unknown, what: string): Record<string, ValueSource> => {
  if (!isObject(value)) return fail(`The declaration's ${what} are missing.`);
  const read: Record<string, ValueSource> = {};
  for (const [variable, source] of Object.entries(value)) {
    read[name(variable, `${what}`)] = isSource(source) ? source : fail(`The declaration takes "${variable}" from "${String(source)}", which is not something a wallet can read from a token or the chain.`);
  }
  return read;
};

const position = (value: unknown, entry: string): DirectPosition | CompanionPosition => {
  if (!isObject(value)) return fail(`The authority entry "${entry}" does not say where its position is.`);
  if (value['companion'] === undefined) {
    return { lockingScript: name(value['lockingScript'], `position script of "${entry}"`), variables: sources(value['variables'], `position variables of "${entry}"`) };
  }
  const { companion, relative, genuine } = value;
  if (!isObject(companion) || companion['tokenCategory'] !== 'token.category') return fail(`The companion coin of "${entry}" must be named by the token's category.`);
  if (typeof relative !== 'number' || !Number.isInteger(relative) || relative === 0 || Math.abs(relative) > 20) return fail(`The declaration does not say where the position of "${entry}" is relative to its companion coin.`);
  // Without it a look-alike of the companion coin would be taken for the position.
  if (!isObject(genuine)) return fail(`The declaration does not say what makes the position of "${entry}" genuine.`);
  if (genuine['tokenCategory'] !== undefined && genuine['tokenCategory'] !== 'token.category' && !isHash(genuine['tokenCategory'])) return fail(`The token the position of "${entry}" must carry is not named by a category.`);
  if (companion['commitment'] !== undefined && !isHex(companion['commitment'])) return fail(`The commitment of the companion coin of "${entry}" is not hex.`);
  return {
    companion: {
      lockingScript: name(companion['lockingScript'], `companion script of "${entry}"`),
      ...(companion['variables'] === undefined ? {} : { variables: sources(companion['variables'], `companion variables of "${entry}"`) }),
      tokenCategory: 'token.category',
      ...(companion['commitment'] === undefined ? {} : { commitment: companion['commitment'] as string }),
    },
    relative,
    genuine: {
      lockingScript: name(genuine['lockingScript'], `position script of "${entry}"`),
      variables: sources(genuine['variables'], `position variables of "${entry}"`),
      ...(genuine['tokenCategory'] === undefined ? {} : { tokenCategory: genuine['tokenCategory'] as string }),
    },
  };
};

const applicationInputs = (value: unknown, action: string): Record<string, ApplicationInput> => {
  if (!isObject(value)) return fail(`The application's inputs of the action "${action}" cannot be read.`);
  const read: Record<string, ApplicationInput> = {};
  for (const [input, described] of Object.entries(value)) {
    if (!isObject(described)) return fail(`The input "${input}" of the action "${action}" cannot be read.`);
    const { token } = described;
    if (token !== undefined) {
      if (!isObject(token)) return fail(`The token of the input "${input}" of the action "${action}" cannot be read.`);
      if (token['category'] !== undefined && !isHash(token['category'])) return fail(`The token of the input "${input}" is not named by a category.`);
      if (token['capability'] !== undefined && !['none', 'mutable', 'minting'].includes(token['capability'] as string)) return fail(`The token of the input "${input}" has a capability that is not known.`);
      if (token['commitment'] !== undefined && !isHex(token['commitment'])) return fail(`The commitment of the token of the input "${input}" is not hex.`);
    }
    read[name(input, 'input')] = {
      lockingScript: name(described['lockingScript'], `script of the input "${input}"`),
      ...(token === undefined ? {} : { token: token as NonNullable<ApplicationInput['token']> }),
    };
  }
  return read;
};

const actionEntry = (value: unknown, action: string): ActionEntry => {
  if (!isObject(value)) return fail(`The declaration's entry for the action "${action}" cannot be read.`);
  const outputs: Record<string, BindingKind> = {};
  if (value['outputs'] !== undefined) {
    if (!isObject(value['outputs'])) return fail(`The wallet's outputs of the action "${action}" cannot be read.`);
    for (const [variable, kind] of Object.entries(value['outputs'])) {
      outputs[name(variable, 'output variable')] = (BINDING_KINDS as readonly unknown[]).includes(kind) ? (kind as BindingKind) : fail(`The action "${action}" asks for an output of kind "${String(kind)}", which is not one of ${BINDING_KINDS.join(', ')}.`);
    }
  }
  return {
    ...(value['creates'] === undefined ? {} : { creates: name(value['creates'], `category variable of "${action}"`) }),
    ...(value['spends'] === undefined ? {} : { spends: name(value['spends'], `spent token of "${action}"`) }),
    ...(value['position'] === undefined ? {} : { position: name(value['position'], `position input of "${action}"`) }),
    ...(value['companion'] === undefined ? {} : { companion: name(value['companion'], `companion input of "${action}"`) }),
    ...(value['inputs'] === undefined ? {} : { inputs: applicationInputs(value['inputs'], action) }),
    ...(value['fromApplication'] === undefined
      ? {}
      : { fromApplication: Array.isArray(value['fromApplication']) ? value['fromApplication'].map((variable) => name(variable, `variables of "${action}" only the application works out`)) : fail(`The variables of "${action}" only the application works out are not a list.`) }),
    ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
    ...(value['variables'] === undefined ? {} : { variables: sources(value['variables'], `variables of "${action}"`) }),
  };
};

/**
 * Read a recovery declaration from its text.
 *
 * @throws UnknownProfileError for a profile or version this wallet does not know
 * @throws DeclarationError if it cannot be read
 */
export const readDeclaration = (text: string): ReadDeclaration => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('The recovery declaration is not readable.');
  }
  if (!isObject(parsed)) return fail('The recovery declaration is not readable.');
  if (parsed['profile'] !== RECOVERY_PROFILE || parsed['version'] !== RECOVERY_PROFILE_VERSION) throw new UnknownProfileError(parsed['profile'], parsed['version']);
  const { template, references, authority, actions } = parsed;
  if (!isObject(template) || !isHash(template['identifier']) || !isHash(template['contentHash'])) return fail('The recovery declaration does not name its template by identifier and content hash.');
  if (references !== undefined && (!Array.isArray(references) || !references.every(isHash))) return fail('The recovery declaration\'s references are not content hashes.');
  if (!isObject(authority)) return fail('The recovery declaration names no authority tokens.');
  const entries: Record<string, AuthorityEntry> = {};
  for (const [entry, value] of Object.entries(authority)) {
    if (!isObject(value)) return fail(`The authority entry "${entry}" cannot be read.`);
    const listed = value['actions'];
    entries[name(entry, 'authority entry')] = {
      token: name(value['token'], `token output of "${entry}"`),
      position: position(value['position'], entry),
      actions: Array.isArray(listed) ? listed.map((action) => name(action, `actions of "${entry}"`)) : fail(`The authority entry "${entry}" lists no actions.`),
      ...(value['state'] === undefined ? {} : { state: sources(value['state'], `state of "${entry}"`) }),
    };
  }
  const actionEntries: Record<string, ActionEntry> = {};
  if (actions !== undefined) {
    if (!isObject(actions)) return fail('The recovery declaration\'s actions cannot be read.');
    for (const [action, value] of Object.entries(actions)) actionEntries[name(action, 'action')] = actionEntry(value, action);
  }
  return {
    text,
    contentHash: textHash(text),
    declaration: {
      profile: RECOVERY_PROFILE,
      version: RECOVERY_PROFILE_VERSION,
      template: { identifier: template['identifier'], contentHash: template['contentHash'] },
      ...(references === undefined ? {} : { references: references as string[] }),
      authority: entries,
      actions: actionEntries,
    },
  };
};

/**
 * Whether a declaration is the one for a template: it names the template by identifier and by content hash.
 * A declaration for another template, or for another text of the same template, does not count.
 */
export const declarationIsFor = (declaration: RecoveryDeclaration, template: Pick<ReadTemplate, 'identifier' | 'contentHash'>): boolean =>
  declaration.template.identifier === template.identifier && declaration.template.contentHash === template.contentHash;

export const isCompanionPosition = (place: DirectPosition | CompanionPosition): place is CompanionPosition => 'companion' in place;
