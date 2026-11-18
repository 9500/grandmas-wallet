import { type Output, binToHex, createVirtualMachineBch2026, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type RecordEntry,
  type Standing,
  type TemplateEntry,
  type TokenNoteEntry,
  type WriteResult,
  assessArchive,
  readArchive,
  safelyStored,
  templateEntry,
} from '@grandmas-wallet/archive';
import {
  type AccountCoin,
  type FollowedScript,
  type PreparedTransaction,
  type ReadTemplate,
  type SeedKeys,
  type TemplateValues,
  type Utxo,
  ADDRESS_KIND,
  INPUT_BYTES,
  TemplateError,
  chooseCoins,
  readControllerHistory,
  readTemplate,
  requiredFee,
  smallestOutputValue,
  templateLockingBytecode,
  templateOutput,
  templateSequenceNumber,
  templateTransaction,
  templateUnlockingBytecode,
  templateWords,
  transactionBytes,
  typedValues,
} from '@grandmas-wallet/core';

import { type ApplicationInput, type AuthorityEntry, type BindingKind, type ReadDeclaration, type RecoveryDeclaration, BINDING_KINDS, isCompanionPosition, readDeclaration } from './declaration.js';
import type { ReservedAddress, Sent, TokenCoin, WalletParts } from './owner-wallet.js';
import { type FoundPosition, type PositionStatus, type TokenOnChain, coinsAt, findPosition, valuesFrom } from './positions.js';
import { type RecoveryArrangement, type StoreAt, writeRecord } from './recovery-flow.js';
import { type PresentedTexts, type TemplateNames, type Verdict, checkTemplate, readPresented } from './template-check.js';

/**
 * Applications (proposal sections 12 to 14): carrying out an action of a template the wallet has never
 * seen, with the wallet's own coins and addresses; saying what a template is and what the wallet could
 * check about it; and finding, from the tokens the wallet holds, the positions they control.
 *
 * Nothing here knows any application. Everything the wallet does for one comes from the application's
 * template and its recovery declaration.
 *
 * The XO engine builds each transaction from the template. Before that, this code works the same
 * transaction out by itself: to choose coins and the exact fee, and to show the user figures that the
 * application cannot influence. What the engine built is then compared with what was worked out, and a
 * difference stops the action before anything is sent.
 */

const hex = binToHex;

/** A template the user trusted on this device. Plain data. */
export interface KeptTemplate {
  identifier: string;
  contentHash: string;
  /** The template as the text it arrived in. */
  text: string;
  declaration?: { contentHash: string; text: string };
  references?: { contentHash: string; text: string }[];
  name: string;
  /** Unix seconds. */
  trustedAt: number;
  /** The applications in a session with which the user trusted it, by the name of each pairing. */
  applications: string[];
  /** A backup store has confirmed the template's record. Until then no signature for one of its actions leaves the wallet. */
  stored: boolean;
  /** A token made with the template has led to its position on chain, as the declaration says. */
  positionFound?: boolean;
}

/** Which template made a token, and which authority entry of its declaration the token stands for. A hint, checked before use. */
export interface TokenNote {
  category: string;
  templateIdentifier: string;
  authority: string;
}

/** A template found in the backup that an earlier owner of the wallet stored. It is a suggestion, not trusted here. */
export interface SuggestedTemplate extends TemplateNames {
  name: string;
  texts: PresentedTexts;
}

export interface ApplicationsState {
  templates: KeptTemplate[];
  notes: TokenNote[];
  suggested?: SuggestedTemplate[];
}

/** What an application, or the user, asks for: an action of a template. */
export interface ApplicationAction {
  template: TemplateNames;
  /** The template itself, for a wallet that does not have it. */
  presented?: PresentedTexts;
  action: string;
  role: string;
  variables: Record<string, string | number>;
  /** Variables that hold a locking script of the wallet's, with the kind of each (section 13.3). */
  bindings?: Record<string, string>;
  /** The variable that receives the category of the tokens the action creates. */
  creates?: string;
  /** The categories of the wallet's tokens the action is about. */
  tokens?: string[];
  /**
   * Coins of the application the action is to spend, by template input, as `<transaction id>:<output index>`:
   * the page's choice among the contracts every user of the application shares. The wallet reads each from
   * the chain and checks it against the template's declaration; an input the request does not name, the
   * wallet finds itself.
   */
  inputs?: Record<string, string>;
  /** The application that asks, by the name of its pairing. Absent when the user acts from the wallet itself. */
  application?: string;
}

/** The backup archive, as far as templates and token notes need it. */
export interface ApplicationArchive {
  write(entry: RecordEntry): Promise<WriteResult>;
  /** The templates and notes in the archive, each with whose it is: the current owner's, or an earlier one's. */
  read(): Promise<{ templates: { entry: TemplateEntry; standing: Standing }[]; tokenNotes: { entry: TokenNoteEntry; standing: Standing }[] }>;
}

/** The archive in use of a recovery arrangement, for templates and token notes. */
export const applicationArchive = (options: {
  arrangement: () => RecoveryArrangement | undefined;
  storeAt: StoreAt;
  seed: Pick<SeedKeys, 'network' | 'controllerKey'>;
  identity: Uint8Array;
  chain: WalletParts['chain'];
}): ApplicationArchive => {
  const arrangement = (): RecoveryArrangement => {
    const current = options.arrangement();
    if (current === undefined) throw new NotStoredError('This wallet has no backup store yet. Set up recovery first; a template is stored there before its first action.');
    return current;
  };
  return {
    write: (entry) => writeRecord({ entry, identity: hex(options.identity), seed: options.seed, arrangement: arrangement(), storeAt: options.storeAt }),
    read: async () => {
      const { archive } = arrangement();
      const contents = await readArchive(hexToBin(archive.archiveId), hexToBin(archive.contentKey), archive.stores.map(options.storeAt));
      const assessment = assessArchive(contents, { network: options.seed.network, history: await readControllerHistory(options.chain, options.identity) });
      return { templates: assessment.templates, tokenNotes: assessment.tokenNotes };
    },
  };
};

/** No backup store has confirmed the template. The action is refused; a note of it on the device does not count (section 10.5). */
export class NotStoredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotStoredError';
  }
}

/** The wallet does not carry the action out, with the reason. */
export class ActionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionRefusedError';
  }
}

const refuse = (message: string): never => {
  throw new ActionRefusedError(message);
};

/** What a template says about itself, and what the wallet can say about it. */
export interface TemplateSummary extends TemplateNames {
  name: string;
  description: string;
  actions: { action: string; name: string; description: string }[];
  verdict: Verdict;
  /** Whether the user has trusted it on this device. */
  trusted: boolean;
}

export interface MovedOutput {
  satoshis: bigint;
  token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } };
}

/** Where an output of the wallet's comes from: a kind the template's declaration names, what is left over, or tokens left over. */
export type WalletOutputKind = BindingKind | 'left over' | 'token change';

/** What an action comes to: the template's words, and the wallet's own figures from the transaction it worked out. */
export interface ActionPreview {
  template: TemplateSummary;
  /** In the template's words. The application chose them. */
  words: {
    action: { name: string; description: string };
    outcome: string;
    values: { name: string; description: string; value: string }[];
  };
  /** The wallet's own figures. The application cannot influence them. */
  figures: {
    /** What leaves the wallet's coins, tokens' coins included. */
    givesSatoshis: bigint;
    /** What arrives at the wallet's addresses. */
    getsSatoshis: bigint;
    feeSatoshis: bigint;
    /** The part of the fee that is too small to return as change. */
    remainderSatoshis: bigint;
    bytes: number;
    /**
     * What goes into the application, in satoshis: what the wallet gives less what it gets and the fee. Below
     * zero, that much comes back from the application to the wallet.
     */
    intoApplicationSatoshis: bigint;
    /** What the action spends of the application's own coins (its contracts, the position): read from the chain by the wallet. */
    fromApplication: { satoshis: bigint; coins: number };
    /** The application's coins the transaction spends, each with the template's name for it. None of them is the wallet's. */
    applicationInputs: (MovedOutput & { name: string; outpoint: string })[];
    /** Outputs that are not the wallet's: what goes to the application's scripts or elsewhere. */
    toOthers: (MovedOutput & { name: string; lockingBytecode: string })[];
    /** Outputs at the wallet's addresses, with the kind of each. */
    toWallet: (MovedOutput & { kind: WalletOutputKind })[];
    /** The wallet's tokens the action spends: the token it is about, and fungible tokens it pays with. */
    tokensSpent: MovedOutput[];
    /** Fungible tokens the wallet ends up with, more or fewer, by category. */
    tokensNet: { category: string; amount: bigint }[];
    /**
     * Tokens the transaction destroys: those sent to a data output, which can never be spent, and those of
     * the application's coins that it does not carry on. Whose they were is said: the wallet's, or the application's.
     */
    tokensDestroyed: { name: string; token: NonNullable<MovedOutput['token']>; how: 'data output' | 'not carried on'; wallet: boolean }[];
    /** The earliest time the network accepts the transaction, as Unix seconds, or as a block height below 500,000,000. */
    notBefore?: number;
    /** The wallet first pays itself, to have a coin that can define a new token. */
    payingItself?: { feeSatoshis: bigint };
  };
  /** The template will be stored in the backup before anything is signed. */
  firstUse: boolean;
}

export interface ActionOutcome {
  transactionId: string;
  sent: Sent;
  /** The key holder's handle to what it built: with the XO engine, the invitation of the application's template. */
  builtAs: string;
  /** The tokens the wallet received. */
  tokens: { category: string; commitment: string; capability: string; satoshis: string; amount?: string }[];
}

/** An action a token's holder can take, in the template's words. */
export interface TokenAction {
  action: string;
  role: string;
  name: string;
  description: string;
  /** Values the user gives when the wallet carries the action out by itself, in the template's words. */
  asks?: { variable: string; name: string; description: string; type: string }[];
  /** Set when the action needs values that only the application works out; the wallet does not offer it by itself then. */
  needsApplication?: string;
}

/** A token the wallet holds, with what the wallet knows about it. */
export interface HeldToken {
  category: string;
  commitment: string;
  capability?: 'none' | 'mutable' | 'minting';
  amount: bigint;
  place: TokenCoin['place'];
  /**
   * - `position`: a trusted template says what the token controls.
   * - `incomplete`: something says what made the token, and the wallet cannot work the rest out; the reason is given.
   * - `unknown`: a token of unknown meaning. It is held and swept all the same.
   */
  meaning: 'position' | 'incomplete' | 'unknown';
  reason?: string;
  template?: { identifier: string; name: string };
  authority?: string;
  position?: {
    status: PositionStatus;
    note?: string;
    satoshis: bigint;
    coins: number;
    lockingBytecode?: string;
    /** What the position holds, read from the chain as the declaration says, in the template's words, with the template's type of each value. */
    state?: { variable: string; name: string; description: string; type: string; value: string }[];
  };
  /** What the token's holder can do, in the template's words. */
  actions?: TokenAction[];
  /** A note about the token that the chain did not bear out, and that was therefore not used. */
  noteRefused?: string;
}

interface PlannedInput {
  coin: AccountCoin;
  inputIdentifier?: string;
  bytes: number;
  /** `application`: a coin of the application's; `token`: the token the action is about; `tokens`: fungible tokens the wallet pays with. */
  kind: 'application' | 'token' | 'tokens' | 'defining' | 'own';
  unlocking?: Uint8Array;
  sequence?: number;
  /** A coin of the application's that the key holder does not follow: it is given its unlocking. */
  given?: boolean;
}

interface PlannedOutput {
  output: Output;
  identifier?: string;
  wallet?: WalletOutputKind;
}

interface Plan {
  template: ReadTemplate;
  role: string;
  action: string;
  values: TemplateValues;
  inputs: PlannedInput[];
  outputs: PlannedOutput[];
  locktime: number;
  reserved: ReservedAddress[];
  /** The addresses among the reserved ones that the transaction uses. */
  used: ReservedAddress[];
  /** Scripts of the template the key holder has to follow to spend the application's coins. */
  follow: FollowedScript[];
  feeSatoshis: bigint;
  remainderSatoshis: bigint;
  bytes: number;
  position?: FoundPosition;
  token?: TokenCoin;
  /** The wallet has no coin that can define a new token: it pays itself this much first. */
  payItself?: bigint;
  created: { category: string; authority?: string; commitment: string; capability: string; satoshis: bigint }[];
}

const tokenOf = (coin: AccountCoin): TokenOnChain | undefined => {
  const { token } = coin.utxo.output;
  return token?.nft === undefined ? undefined : { category: token.category, commitment: token.nft.commitment, capability: token.nft.capability };
};
const tokenMoved = (token: NonNullable<Output['token']>): NonNullable<MovedOutput['token']> => ({
  category: hex(token.category),
  amount: token.amount,
  ...(token.nft === undefined ? {} : { nft: { capability: token.nft.capability, commitment: hex(token.nft.commitment) } }),
});
const moved = (output: Output): MovedOutput => ({ satoshis: output.valueSatoshis, ...(output.token === undefined ? {} : { token: tokenMoved(output.token) }) });
const sameToken = (a: Output['token'], b: Output['token']): boolean =>
  a !== undefined && b !== undefined && hex(a.category) === hex(b.category) && a.amount === b.amount && a.nft?.capability === b.nft?.capability && hex(a.nft?.commitment ?? new Uint8Array()) === hex(b.nft?.commitment ?? new Uint8Array());
const sameOutput = (a: Output, b: Output): boolean =>
  hex(a.lockingBytecode) === hex(b.lockingBytecode) && a.valueSatoshis === b.valueSatoshis && (a.token === undefined ? b.token === undefined : sameToken(a.token, b.token));
const inputBytes = (unlocking: Uint8Array): number => 32 + 4 + (unlocking.length < 0xfd ? 1 : 3) + unlocking.length + 4;
const sum = (values: bigint[]): bigint => values.reduce((total, value) => total + value, 0n);
const outpointOf = (utxo: Utxo): string => `${hex(utxo.transactionHash)}:${utxo.index}`;
/** Fungible amounts by category. */
const fungible = (outputs: Output[]): Map<string, bigint> => {
  const amounts = new Map<string, bigint>();
  for (const { token } of outputs) if (token !== undefined && token.amount > 0n) amounts.set(hex(token.category), (amounts.get(hex(token.category)) ?? 0n) + token.amount);
  return amounts;
};
/** A data output: it can never be spent, and what it carries is destroyed. */
const isDataOutput = (output: Output): boolean => output.lockingBytecode[0] === 0x6a;
/** The template's variables that a script of it reads, as `<name>`. */
const scriptVariables = (definition: ReadTemplate['definition'], lockingScript: string): string[] => {
  const text = definition.scripts?.[definition.lockingScripts?.[lockingScript]?.lockingBytecode ?? ''] ?? '';
  return [...new Set([...text.matchAll(/<\$?\(?<?([A-Za-z_][A-Za-z0-9_]*)>?/g)].map((match) => match[1] as string))].filter((name) => definition.variables?.[name] !== undefined);
};
const vm = createVirtualMachineBch2026(true);
/** The bytes that stand for a signature of the wallet's while a transaction is worked out: a coin of the wallet's is unlocked only by the key holder. */
const PLACEHOLDER_UNLOCKING = new Uint8Array(253);
const PLACEHOLDER_CATEGORY = '00'.repeat(32);

/** What a position holds, read from the chain as the declaration says, in the template's words. A value that cannot be read is left out. */
const positionState = (definition: ReadTemplate['definition'], entry: AuthorityEntry, found: FoundPosition, token: TokenOnChain): NonNullable<NonNullable<HeldToken['position']>['state']> =>
  Object.entries(entry.state ?? {}).flatMap(([variable, source]) => {
    try {
      const [first] = found.coins;
      const value = valuesFrom(definition, { [variable]: source }, {
        token,
        ...(found.companion === undefined ? {} : { companion: found.companion.output }),
        ...(first === undefined ? {} : { position: first.output }),
        positionSatoshis: sum(found.coins.map((coin) => coin.output.valueSatoshis)),
      })[variable];
      const described = definition.variables?.[variable];
      return value === undefined ? [] : [{ variable, name: described?.name ?? variable, description: described?.description ?? '', type: String(described?.type ?? 'bytes'), value: String(value) }];
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return [];
    }
  });

/**
 * What the wallet needs to carry an action out by itself, from its list of tokens: the values the user gives,
 * or, when the action needs a value that neither the chain nor the user can give, that it needs the application.
 */
const offered = (definition: ReadTemplate['definition'], declaration: RecoveryDeclaration, action: string, role: string): Pick<TokenAction, 'asks' | 'needsApplication'> => {
  const entry = declaration.actions[action] ?? {};
  const required = definition.actions?.[action]?.roles?.[role]?.requirements?.variables ?? [];
  const filled = new Set([...Object.keys(entry.outputs ?? {}), ...Object.keys(entry.variables ?? {}), ...(entry.creates === undefined ? [] : [entry.creates])]);
  const theirs = new Set(entry.fromApplication ?? []);
  const asked = required.filter((variable) => !filled.has(variable) && !theirs.has(variable));
  const missing = required.filter((variable) => !filled.has(variable) && theirs.has(variable));
  return {
    ...(asked.length === 0
      ? {}
      : {
          asks: asked.map((variable) => {
            const described = definition.variables?.[variable];
            return { variable, name: described?.name ?? variable, description: described?.description ?? '', type: String(described?.type ?? 'bytes') };
          }),
        }),
    ...(missing.length === 0 ? {} : { needsApplication: `It needs values that the application works out: ${missing.map((variable) => `"${definition.variables?.[variable]?.name ?? variable}"`).join(', ')}.` }),
  };
};

export class Applications {
  constructor(
    private readonly wallet: WalletParts,
    private readonly options: {
      /** Where templates are stored before their first action. Without it, actions of a new template are refused. */
      archive?: ApplicationArchive;
      now?: () => number;
      /**
       * The key holder follows the script of an application's coin, and unlocks the coin by the template itself,
       * when the template does not say that it need not track it, and no more than this many coins are unspent
       * there and this many transactions are in its history (50 unless given). A coin at a script that many
       * share, such as a contract every user of the application uses, is given to the key holder with the
       * unlocking the wallet worked out from the template: following the script would bring every user's coins
       * and every transaction of its history into the key holder's store.
       */
      followUpTo?: number;
    } = {},
  ) {}

  private get state(): ApplicationsState {
    return this.wallet.kept() ?? { templates: [], notes: [] };
  }

  private change(change: Partial<ApplicationsState>): void {
    this.wallet.store({ ...this.state, ...change });
  }

  private updateTemplate(identifier: string, change: Partial<KeptTemplate>): KeptTemplate {
    const templates = this.state.templates.map((template) => (template.identifier === identifier ? { ...template, ...change } : template));
    this.change({ templates });
    return templates.find((template) => template.identifier === identifier) as KeptTemplate;
  }

  /** The templates the user trusted on this device. */
  get templates(): KeptTemplate[] {
    return this.state.templates;
  }

  /** Templates an earlier owner of the wallet stored in the backup, which this device has not been told to trust. */
  get suggestions(): SuggestedTemplate[] {
    return (this.state.suggested ?? []).filter((suggested) => !this.state.templates.some((kept) => kept.identifier === suggested.identifier && kept.contentHash === suggested.contentHash));
  }

  private keptTemplate(names: Pick<TemplateNames, 'identifier' | 'contentHash'>): KeptTemplate | undefined {
    return this.state.templates.find((kept) => kept.identifier === names.identifier && kept.contentHash === names.contentHash);
  }

  /** Whether the wallet has a template, by the names a request gives it. A different text under the same identifier is another template. */
  has(names: TemplateNames): boolean {
    const kept = this.keptTemplate(names);
    return kept !== undefined && kept.declaration?.contentHash === names.declaration;
  }

  private read(kept: KeptTemplate): { template: ReadTemplate; declaration?: ReadDeclaration } {
    return { template: readTemplate(kept.text), ...(kept.declaration === undefined ? {} : { declaration: readDeclaration(kept.declaration.text) }) };
  }

  /** The template of a request: the wallet's own copy of one it trusts, or what the request presents, checked against its names. */
  private templateOf(request: Pick<ApplicationAction, 'template' | 'presented'>): { template: ReadTemplate; declaration?: ReadDeclaration; kept?: KeptTemplate; texts?: PresentedTexts } {
    const kept = this.keptTemplate(request.template);
    if (kept !== undefined) {
      if (kept.declaration?.contentHash !== request.template.declaration && request.template.declaration !== undefined) {
        return refuse('The request names another recovery declaration than the one this wallet trusted with the template.');
      }
      return { ...this.read(kept), kept };
    }
    if (request.presented === undefined) return refuse('This wallet does not have that template. Send the template with the request.');
    const presented = readPresented(request.template, request.presented);
    return { template: presented.template, ...(presented.declaration === undefined ? {} : { declaration: presented.declaration }), texts: request.presented };
  }

  private summary(template: ReadTemplate, declaration: ReadDeclaration | undefined, kept: KeptTemplate | undefined): TemplateSummary {
    const { definition } = template;
    return {
      identifier: template.identifier,
      contentHash: template.contentHash,
      ...(declaration === undefined ? {} : { declaration: declaration.contentHash }),
      name: definition.name ?? 'Unnamed template',
      description: definition.description ?? '',
      actions: Object.entries(definition.actions ?? {}).map(([action, { name, description }]) => ({ action, name: name ?? action, description: description ?? '' })),
      verdict: checkTemplate(template, declaration, kept?.positionFound === true ? { positionFound: true } : {}),
      trusted: kept !== undefined,
    };
  }

  /**
   * What a template is and what the wallet can say about it, without taking it in.
   * @throws PresentationError if it is not what the names say; UnknownProfileError for a declaration this wallet cannot read
   */
  describe(names: TemplateNames, presented?: PresentedTexts): TemplateSummary {
    const { template, declaration, kept } = this.templateOf({ template: names, ...(presented === undefined ? {} : { presented }) });
    return this.summary(template, declaration, kept);
  }

  /**
   * Trust a template on the user's word, and store it in the backup. Storing may fail; the template is then
   * trusted on this device and not yet stored, and no signature for one of its actions leaves the wallet.
   */
  async trust(names: TemplateNames, presented: PresentedTexts | undefined, application?: string): Promise<KeptTemplate> {
    let kept = this.keptTemplate(names);
    if (kept === undefined) {
      const texts = presented ?? this.suggestions.find((suggested) => suggested.identifier === names.identifier && suggested.contentHash === names.contentHash)?.texts;
      if (texts === undefined) return refuse('This wallet does not have that template.');
      const read = readPresented(names, texts);
      const verdict = checkTemplate(read.template, read.declaration);
      if (verdict.statement === 'violation') {
        return refuse(`This wallet does not take the template in: ${verdict.violations.map((violation) => `rule ${violation.rule}: ${violation.what} ${violation.consequence}`).join(' ')}`);
      }
      kept = {
        identifier: read.template.identifier,
        contentHash: read.template.contentHash,
        text: read.template.text,
        ...(read.declaration === undefined ? {} : { declaration: { contentHash: read.declaration.contentHash, text: read.declaration.text } }),
        ...(read.references.length === 0 ? {} : { references: read.references }),
        name: read.template.definition.name ?? 'Unnamed template',
        trustedAt: this.options.now?.() ?? Math.floor(Date.now() / 1000),
        applications: [],
        stored: false,
      };
      this.change({ templates: [...this.state.templates, kept] });
    }
    if (application !== undefined && !kept.applications.includes(application)) kept = this.updateTemplate(kept.identifier, { applications: [...kept.applications, application] });
    return kept;
  }

  /**
   * Make sure the template is on a backup store before something comes to depend on it (section 10.5).
   * @throws NotStoredError when no store confirms; the device's own record of the template does not count
   */
  private async ensureStored(kept: KeptTemplate): Promise<KeptTemplate> {
    if (kept.stored) return kept;
    const { archive } = this.options;
    if (archive === undefined) throw new NotStoredError('This wallet has no backup store. A template is stored there before its first action, so that a new device can operate what was made with it.');
    const result = await archive.write(templateEntry(kept.identifier, kept.text, kept.declaration?.text, (kept.references ?? []).map((reference) => reference.text)));
    if (!safelyStored(result)) {
      throw new NotStoredError(`No backup store confirmed the template: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ') || 'none is configured'}. Nothing was signed. Try again when a store can be reached.`);
    }
    return this.updateTemplate(kept.identifier, { stored: true });
  }

  // ------------------------------------------------------------------ working an action out

  private async plan(request: ApplicationAction, definingCoin?: AccountCoin): Promise<Plan> {
    const { template, declaration } = this.templateOf(request);
    const { definition } = template;
    const declared: RecoveryDeclaration | undefined = declaration?.declaration;
    const action = definition.actions?.[request.action];
    if (action === undefined) return refuse(`The template "${definition.name ?? ''}" has no action "${request.action}".`);
    if (action.roles?.[request.role] === undefined) return refuse(`The action "${action.name ?? request.action}" has no role "${request.role}".`);
    const shape = definition.transactions?.[action.transaction ?? ''] as { inputs?: { input: string; inputIndex?: number }[]; outputs?: { output: string; outputIndex?: number }[] } | undefined;
    if (shape === undefined) return refuse(`The action "${action.name ?? request.action}" has no transaction.`);
    const entry = declared?.actions[request.action] ?? {};

    // The wallet's parts of the action: from the declaration, and from the request where it says the same.
    const bindings: Record<string, BindingKind> = { ...entry.outputs };
    for (const [variable, kind] of Object.entries(request.bindings ?? {})) {
      if (!(BINDING_KINDS as readonly string[]).includes(kind)) return refuse(`The request asks for an output of kind "${kind}", which this wallet does not offer.`);
      if (bindings[variable] !== undefined && bindings[variable] !== kind) return refuse(`The request and the template's declaration disagree about the wallet's output "${variable}".`);
      bindings[variable] = kind as BindingKind;
    }
    if (entry.creates !== undefined && request.creates !== undefined && entry.creates !== request.creates) return refuse('The request and the template\'s declaration disagree about which variable names the new token.');
    const creates = entry.creates ?? request.creates;
    const described = entry.inputs ?? {};
    for (const input of Object.keys(request.inputs ?? {})) {
      if (described[input] === undefined) return refuse(`The request names a coin for "${definition.inputs?.[input]?.name ?? input}", and the template's declaration does not say what may be spent there.`);
    }

    // The token the action is about, and the position it controls.
    const sourced = Object.entries(entry.variables ?? {});
    const fromToken = sourced.filter(([, source]) => !source.startsWith('input.'));
    const fromInputs = sourced.filter(([, source]) => source.startsWith('input.'));
    const usesToken = entry.spends !== undefined || entry.position !== undefined || entry.companion !== undefined || fromToken.length > 0;
    let token: TokenCoin | undefined;
    let authority: [string, AuthorityEntry] | undefined;
    let position: FoundPosition | undefined;
    if (usesToken) {
      if (declared === undefined) return refuse('The action is about a token, and the template comes without a recovery declaration that says how.');
      const [category, ...others] = request.tokens ?? [];
      if (category === undefined || others.length > 0) return refuse('The action is about one token of the wallet; the request has to name it.');
      const held = (await this.wallet.tokenCoins()).filter(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category && coin.utxo.output.token?.nft !== undefined);
      [token] = held;
      if (token === undefined) return refuse('This wallet holds no such token.');
      if (held.length > 1) return refuse('This wallet holds more than one coin with that token; it does not choose between them.');
      if (token.place === 'earlier') return refuse('The token is at an address of an earlier seed, where that seed could still spend it. It is swept first.');
      if (token.place === 'vault') return refuse('The token is at a vault address. It is moved to an ordinary address of the wallet first.');
      authority = entry.spends !== undefined ? [entry.spends, declared.authority[entry.spends] as AuthorityEntry] : Object.entries(declared.authority).find(([, candidate]) => candidate.actions.includes(request.action));
      const onChain = tokenOf(token.coin);
      if (authority === undefined || authority[1] === undefined || onChain === undefined) return refuse('The template\'s declaration does not say what this token has to do with the action.');
      // The rebuild check: the token has to lead to a position of this template on chain (section 10.4).
      position = await findPosition(this.wallet.chain, definition, authority[1], onChain);
      if (position.status === 'not found' || position.status === 'incomplete' || position.status === 'ambiguous') {
        return refuse(`This token does not lead to a position of the template "${definition.name ?? ''}": ${position.note ?? position.status}`);
      }
      if ((entry.position !== undefined || entry.companion !== undefined) && position.status !== 'open') return refuse(`There is nothing to spend: ${position.note ?? 'the position is closed.'}`);
      if (entry.companion !== undefined && position.companion === undefined) return refuse('The action spends the coin its position was found through, and the declaration finds the position without one.');
    } else if ((request.tokens ?? []).length > 0) {
      return refuse('The request names a token, and the template does not say that this action is about one.');
    }

    // Addresses: one for each output the action leaves to the wallet, and one for what is left over.
    const boundVariables = Object.keys(bindings).filter((variable) => bindings[variable] !== 'return');
    const kinds = [...boundVariables.map((variable) => (bindings[variable] === 'lasting' ? ADDRESS_KIND.vault : ADDRESS_KIND.change)), ADDRESS_KIND.change];
    let reserved = this.wallet.reserve(kinds);
    const leftOver = reserved.at(-1) as ReservedAddress;
    const walletScripts = new Map<string, WalletOutputKind>();
    walletScripts.set(hex(leftOver.address.lockingBytecode), 'left over');

    // The values: the application's, then what the wallet takes from the token and the chain, then the wallet's own.
    // An address the application supplies for an output of the wallet's is not used.
    const wallets = new Set([...Object.keys(bindings), ...(creates === undefined ? [] : [creates])]);
    const supplied = Object.fromEntries(Object.entries(request.variables).filter(([variable]) => !wallets.has(variable)));
    let values: TemplateValues;
    const tokenInputIndex = (): number => {
      const before = (shape.inputs ?? []).length + (entry.position === undefined ? 0 : Math.max((position?.coins.length ?? 1) - 1, 0));
      return before;
    };
    const fromChain = (wanted: [string, string][], inputs?: Record<string, Output>): TemplateValues => {
      if (wanted.length === 0) return {};
      const onChain = token === undefined ? undefined : tokenOf(token.coin);
      const [first] = position?.coins ?? [];
      return valuesFrom(definition, Object.fromEntries(wanted), {
        token: onChain ?? { category: new Uint8Array(), commitment: new Uint8Array(), capability: 'none' },
        ...(token === undefined ? {} : { tokenSatoshis: token.coin.utxo.output.valueSatoshis }),
        ...(position?.companion === undefined ? {} : { companion: position.companion.output }),
        ...(first === undefined ? {} : { position: first.output }),
        ...(position === undefined ? {} : { positionSatoshis: sum(position.coins.map((coin) => coin.output.valueSatoshis)) }),
        tokenInputIndex: tokenInputIndex(),
        ...(inputs === undefined ? {} : { inputs }),
      });
    };
    try {
      values = typedValues(definition, supplied);
      if (position !== undefined) Object.assign(values, position.variables);
      Object.assign(values, fromChain(fromToken));
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }
    boundVariables.forEach((variable, index) => {
      const { address } = reserved[index] as ReservedAddress;
      values[variable] = hex(address.lockingBytecode);
      walletScripts.set(hex(address.lockingBytecode), bindings[variable] as BindingKind);
    });
    for (const [variable, kind] of Object.entries(bindings)) {
      if (kind !== 'return') continue;
      if (token === undefined || entry.spends === undefined) return refuse(`The output "${variable}" is to return to the script of an input that is not the wallet's.`);
      values[variable] = hex(token.coin.utxo.output.lockingBytecode);
      walletScripts.set(hex(token.coin.utxo.output.lockingBytecode), 'return');
    }

    // The application's coins: the position, the coin it was found through, and the contracts it shares, each
    // read from the chain by the wallet and checked to be unspent at the script the template gives it.
    const follow = new Map<string, FollowedScript>();
    const following = new Map<string, string>();
    const followed = (lockingScript: string, variables: TemplateValues): void => {
      const own = Object.fromEntries(scriptVariables(definition, lockingScript).flatMap((name) => (variables[name] === undefined ? [] : [[name, variables[name] as string | number | bigint]])));
      const key = `${lockingScript}:${JSON.stringify(own, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value))}`;
      follow.set(key, { template: template.identifier, lockingScript, role: request.role, variables: own });
      following.set(hex(applicationCoins.at(-1)?.utxo.output.lockingBytecode ?? new Uint8Array()), key);
    };
    const applicationCoins: { input: string; index?: number; utxo: Utxo; lockingScript: string }[] = [];
    const read: Record<string, Output> = {};
    try {
      for (const { input, inputIndex } of shape.inputs ?? []) {
        if (input === entry.position) {
          const coins = position?.coins ?? [];
          if (coins.length === 0) return refuse('There is nothing to spend: the position holds no coin.');
          if (inputIndex !== undefined && coins.length > 1) return refuse('The template gives the position one place in the transaction, and it is made of several coins.');
          for (const utxo of coins) applicationCoins.push({ input, ...(inputIndex === undefined ? {} : { index: inputIndex }), utxo, lockingScript: position?.lockingScript ?? '' });
          followed(position?.lockingScript ?? '', position?.variables ?? {});
          continue;
        }
        if (input === entry.companion) {
          const place = authority?.[1].position;
          if (position?.companion === undefined || place === undefined || !isCompanionPosition(place)) return refuse('The action spends the coin its position was found through, and there is none.');
          applicationCoins.push({ input, ...(inputIndex === undefined ? {} : { index: inputIndex }), utxo: position.companion, lockingScript: place.companion.lockingScript });
          followed(place.companion.lockingScript, fromChain(Object.entries(place.companion.variables ?? {})));
          continue;
        }
        const wanted = described[input];
        if (wanted === undefined) return refuse(`The action spends a coin as "${definition.inputs?.[input]?.name ?? input}", and the template's declaration does not say where the wallet finds it.`);
        const utxo = await this.applicationCoin(definition, input, wanted, values, request.inputs?.[input]);
        if (applicationCoins.some((coin) => outpointOf(coin.utxo) === outpointOf(utxo))) return refuse(`The coin for "${definition.inputs?.[input]?.name ?? input}" is already spent as another input of the action.`);
        applicationCoins.push({ input, ...(inputIndex === undefined ? {} : { index: inputIndex }), utxo, lockingScript: wanted.lockingScript });
        read[input] = utxo.output;
        followed(wanted.lockingScript, values);
      }
      if (entry.position !== undefined && !applicationCoins.some(({ input }) => input === entry.position)) return refuse('The template\'s declaration names an input that the action does not have.');
      Object.assign(values, fromChain(fromInputs, read));
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }

    // A new token category is the transaction whose output 0 is spent: the wallet supplies that coin.
    const own = await this.wallet.ownCoins();
    let defining = definingCoin;
    let virtual = false;
    if (creates !== undefined) {
      defining ??= [...own].filter((coin) => coin.utxo.index === 0).sort((a, b) => (a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : 1))[0];
      virtual = defining === undefined;
      values[creates] = defining === undefined ? PLACEHOLDER_CATEGORY : hex(defining.utxo.transactionHash);
    }

    let templateOutputs: (PlannedOutput & { index?: number })[];
    let applicationInputs: (PlannedInput & { index?: number })[];
    let locktime: number;
    try {
      const transaction = templateTransaction(definition, request.action, values);
      locktime = transaction.locktime;
      applicationInputs = applicationCoins.map(({ input, index, utxo, lockingScript }) => {
        const unlocking = templateUnlockingBytecode(definition, lockingScript, input, values);
        return {
          coin: { utxo, template: template.identifier, height: 0 },
          inputIdentifier: input,
          bytes: inputBytes(unlocking),
          kind: 'application' as const,
          unlocking,
          sequence: templateSequenceNumber(definition, input, values) ?? 0,
          ...(index === undefined ? {} : { index }),
        };
      });
      templateOutputs = transaction.outputs.map(({ output, index }) => {
        const made = templateOutput(definition, output, values);
        const wallet = walletScripts.get(hex(made.lockingBytecode));
        return { output: made, identifier: output, ...(wallet === undefined ? {} : { wallet }), ...(index === undefined ? {} : { index }) };
      });
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }
    for (const { output, identifier } of templateOutputs) {
      const smallest = smallestOutputValue(output);
      if (output.valueSatoshis < smallest) return refuse(`The action would put ${output.valueSatoshis} satoshis in "${definition.outputs?.[identifier ?? '']?.name ?? identifier}", less than the ${smallest} the network relays there.`);
    }
    // Scripts the template says the key holder need not track, and scripts many coins share, are not followed:
    // those coins are given with their unlocking.
    const crowded = new Set<string>();
    const untracked = new Set(
      applicationCoins
        .filter(({ lockingScript }) => {
          const script = definition.lockingScripts?.[lockingScript] as { relevant?: unknown; roles?: Record<string, { relevant?: unknown }> } | undefined;
          return script?.relevant === false || script?.roles?.[request.role]?.relevant === false;
        })
        .map(({ utxo }) => hex(utxo.output.lockingBytecode)),
    );
    for (const script of new Set(applicationInputs.map(({ coin }) => hex(coin.utxo.output.lockingBytecode)))) {
      const most = this.options.followUpTo ?? 50;
      if (untracked.has(script) || (await this.wallet.chain.listUnspent(hexToBin(script))).length > most || (await this.wallet.chain.getHistory(hexToBin(script))).length > most) {
        crowded.add(script);
        follow.delete(following.get(script) ?? '');
      }
    }
    for (const input of applicationInputs) if (crowded.has(hex(input.coin.utxo.output.lockingBytecode))) input.given = true;
    const tokenInput: PlannedInput[] = token !== undefined && entry.spends !== undefined ? [{ coin: token.coin, bytes: INPUT_BYTES.byKey, kind: 'token' }] : [];

    // Fungible tokens the outputs carry and the application's coins do not bring: the wallet pays them from its
    // own, and what is left of them comes back at a fresh address.
    const brought = fungible([...applicationInputs, ...tokenInput].map(({ coin }) => coin.utxo.output));
    const tokenInputs: PlannedInput[] = [];
    const tokenChange: { category: string; amount: bigint }[] = [];
    const fungibleCoins = (await this.wallet.tokenCoins()).filter(({ coin, place }) => place === 'address' && coin.utxo.output.token !== undefined && coin.utxo.output.token.nft === undefined && coin !== token?.coin);
    for (const [category, amount] of fungible(templateOutputs.map(({ output }) => output))) {
      const needed = amount - (brought.get(category) ?? 0n);
      if (needed <= 0n) continue;
      const candidates = fungibleCoins.filter(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array()) === category).sort((a, b) => ((a.coin.utxo.output.token?.amount ?? 0n) > (b.coin.utxo.output.token?.amount ?? 0n) ? -1 : 1));
      let gathered = 0n;
      for (const { coin } of candidates) {
        if (gathered >= needed) break;
        tokenInputs.push({ coin, bytes: INPUT_BYTES.byKey, kind: 'tokens' });
        gathered += coin.utxo.output.token?.amount ?? 0n;
      }
      if (gathered < needed) return refuse(`The action needs ${needed} tokens of the category ${category} from the wallet, and the wallet holds ${gathered} where it can spend them.`);
      if (gathered > needed) tokenChange.push({ category, amount: gathered - needed });
    }
    if (tokenChange.length > 0) {
      const more = this.wallet.reserve([...kinds, ...tokenChange.map(() => ADDRESS_KIND.change)]);
      if (more.slice(0, kinds.length).some((entry, index) => entry.address.number !== reserved[index]?.address.number || entry.address.kind !== reserved[index]?.address.kind)) {
        throw new Error('The wallet\'s addresses changed while the action was being worked out. Try again.');
      }
      reserved = more;
    }
    const changeOutputs: PlannedOutput[] = tokenChange.map(({ category, amount }, index) => {
      const output: Output = { lockingBytecode: (reserved[kinds.length + index] as ReservedAddress).address.lockingBytecode, valueSatoshis: 0n, token: { category: hexToBin(category), amount } };
      return { output: { ...output, valueSatoshis: smallestOutputValue(output) }, wallet: 'token change' };
    });

    // Coins and the exact fee (section 8).
    const fixedInputs = [...applicationInputs, ...tokenInput, ...tokenInputs];
    const paying = [...templateOutputs, ...changeOutputs].map(({ output }) => output);
    // A template may leave a place among its outputs to the wallet, such as output 0 before the outputs it
    // places itself. When nothing else of the wallet's fills it, something has to be left over to go there.
    const placedAt = new Set(templateOutputs.flatMap(({ index }) => (index === undefined ? [] : [index])));
    const holes = Math.max(-1, ...placedAt) + 1 - placedAt.size;
    const mustLeave = holes > templateOutputs.filter(({ index }) => index === undefined).length + changeOutputs.length;
    const smallest = smallestOutputValue({ lockingBytecode: leftOver.address.lockingBytecode, valueSatoshis: 0n });
    const leastLeftOver: Output = { lockingBytecode: leftOver.address.lockingBytecode, valueSatoshis: smallest };
    let payItself: bigint | undefined;
    if (virtual) {
      // The wallet will first pay itself, exactly what the action then takes from that one coin.
      const outputs = mustLeave ? [...paying, leastLeftOver] : paying;
      const bytes = transactionBytes([...fixedInputs.map((input) => input.bytes), INPUT_BYTES.byKey], outputs);
      const needed = sum(outputs.map((output) => output.valueSatoshis)) + requiredFee(bytes, this.wallet.feeRate) - sum(fixedInputs.map((input) => input.coin.utxo.output.valueSatoshis));
      payItself = needed > smallest ? needed : smallest;
      defining = { utxo: { transactionHash: new Uint8Array(32), index: 0, output: { lockingBytecode: leftOver.address.lockingBytecode, valueSatoshis: payItself } }, template: 'change', height: 0 };
    }
    const definingInput: PlannedInput[] = defining === undefined ? [] : [{ coin: defining, bytes: INPUT_BYTES.byKey, kind: 'defining' }];
    const fixed = new Set([...fixedInputs, ...definingInput].map((input) => outpointOf(input.coin.utxo)));
    const available = virtual ? [] : own.filter((coin) => !fixed.has(outpointOf(coin.utxo)));
    const choosing = {
      available: available.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.byKey })),
      fixedInputs: [...fixedInputs, ...definingInput].map((input) => ({ utxo: input.coin.utxo, inputBytes: input.bytes })),
      changeLockingBytecode: leftOver.address.lockingBytecode,
      feeRate: this.wallet.feeRate,
    };
    let choice = chooseCoins({ ...choosing, outputs: paying });
    if (mustLeave && choice.changeSatoshis === undefined) {
      // The coins come out without anything left over: they are chosen again so that the least an output may
      // hold is left, and whatever more there is goes to that one output, at the exact fee.
      const again = chooseCoins({ ...choosing, outputs: [...paying, leastLeftOver] });
      const spending = [...choosing.fixedInputs, ...again.coins];
      const bytes = transactionBytes(spending.map((coin) => coin.inputBytes), [...paying, leastLeftOver]);
      const feeSatoshis = requiredFee(bytes, this.wallet.feeRate);
      const changeSatoshis = sum(spending.map((coin) => coin.utxo.output.valueSatoshis)) - sum(paying.map((output) => output.valueSatoshis)) - feeSatoshis;
      choice = { coins: again.coins, changeSatoshis, feeSatoshis, remainderSatoshis: 0n, bytes };
    }
    const chosen: PlannedInput[] = choice.coins.map(({ utxo }) => ({ coin: available.find((coin) => coin.utxo === utxo) as AccountCoin, bytes: INPUT_BYTES.byKey, kind: 'own' }));
    const leftOverOutput: PlannedOutput[] = choice.changeSatoshis === undefined ? [] : [{ output: { lockingBytecode: leftOver.address.lockingBytecode, valueSatoshis: choice.changeSatoshis }, wallet: 'left over' }];

    // Places: what the template places is where it says; the coin that defines a new token category is input 0
    // (the network's rule); everything else takes the lowest place left, in order: the template's other items,
    // then the token the action is about, the wallet's tokens and its other coins; the wallet's tokens left
    // over, then what is left over.
    const place = <Item>(placed: (Item & { index?: number })[], first: Item | undefined, rest: Item[], what: string): Item[] => {
      const slots: (Item | undefined)[] = [];
      for (const item of placed.filter((candidate) => candidate.index !== undefined)) {
        const index = item.index as number;
        if (slots[index] !== undefined) return refuse(`The template puts two of its ${what}s at place ${index}.`);
        slots[index] = item;
      }
      if (first !== undefined) {
        if (slots[0] !== undefined) return refuse(`The template takes ${what} 0, where the coin that defines a new token category has to be.`);
        slots[0] = first;
      }
      for (const item of [...placed.filter((candidate) => candidate.index === undefined), ...rest]) {
        const free = slots.findIndex((slot) => slot === undefined);
        if (free >= 0) slots[free] = item;
        else slots.push(item);
      }
      const gap = slots.findIndex((slot) => slot === undefined);
      if (gap >= 0) return refuse(`The template leaves ${what} ${gap} to the wallet, and the wallet has nothing to put there.`);
      return slots as Item[];
    };
    const inputs = place<PlannedInput>(applicationInputs, definingInput[0], [...tokenInput, ...tokenInputs, ...chosen], 'input');
    const planned = place<PlannedOutput>(templateOutputs, undefined, [...changeOutputs, ...leftOverOutput], 'output');
    for (const input of inputs) delete (input as { index?: number }).index;
    for (const output of planned) delete (output as { index?: number }).index;

    // A token that carries authority is a bearer instrument: the one the action spends has to come back to the wallet.
    if (token !== undefined && entry.spends !== undefined) {
      const spent = token.coin.utxo.output.token;
      if (!planned.some(({ output, wallet }) => wallet !== undefined && sameToken(output.token, spent))) {
        return refuse('The action would not return the token it spends to the wallet. A position whose token is gone can never be operated again.');
      }
    }
    // The place of the token among the inputs, as the declaration may have given it to the template.
    if (fromToken.some(([, source]) => source === 'token.inputIndex') && token !== undefined) {
      const at = inputs.findIndex((input) => input.coin === token?.coin);
      const [name] = fromToken.find(([, source]) => source === 'token.inputIndex') ?? [];
      if (name !== undefined && values[name] !== BigInt(at)) return refuse('The token would not be at the place the template was told it is.');
    }

    // An authority token the action gives the wallet without spending one has to lead to what the action pays
    // in, by the declaration's own rule: otherwise a recovered wallet could not find it.
    const created: Plan['created'] = [];
    for (const [index, { output, identifier, wallet }] of planned.entries()) {
      if (output.token?.nft === undefined || wallet === undefined || identifier === undefined) continue;
      const named = Object.entries(declared?.authority ?? {}).find(([, candidate]) => candidate.token === identifier);
      const isCreated = creates !== undefined && hex(output.token.category) === values[creates];
      if (named === undefined ? !isCreated : entry.spends === named[0]) continue;
      if (named !== undefined && !this.leadsToPosition(definition, named[1], planned, index)) {
        return refuse('The token this action gives the wallet would not lead to what the action pays in. After a recovery the wallet could not find it.');
      }
      created.push({ category: hex(output.token.category), commitment: hex(output.token.nft.commitment), capability: output.token.nft.capability, satoshis: output.valueSatoshis, ...(named === undefined ? {} : { authority: named[0] }) });
    }

    // The application's contracts are evaluated against the transaction the wallet worked out, before anything
    // is signed: a value the application gave that its own contracts do not accept is a refusal, not a loss.
    this.evaluateApplicationInputs(definition, inputs, planned, locktime);

    // An address the action writes anywhere, such as one stored now and paid later, stays taken; the one for
    // what is left over only if something was left over.
    const leftOverUsed = planned.some(({ wallet }) => wallet === 'left over');
    return {
      template,
      role: request.role,
      action: request.action,
      values,
      inputs,
      outputs: planned,
      locktime,
      reserved,
      used: reserved.filter((entry) => entry !== leftOver || leftOverUsed),
      follow: [...follow.values()],
      feeSatoshis: choice.feeSatoshis,
      remainderSatoshis: choice.remainderSatoshis,
      bytes: choice.bytes,
      ...(position === undefined ? {} : { position }),
      ...(token === undefined ? {} : { token }),
      ...(payItself === undefined ? {} : { payItself }),
      created,
    };
  }

  /**
   * A coin of the application's that an action spends as a template input: the one the request names, checked,
   * or one the wallet finds. It is read from the chain, unspent, at the script the template gives the input, with
   * the token the declaration describes.
   */
  private async applicationCoin(definition: ReadTemplate['definition'], input: string, wanted: ApplicationInput, values: TemplateValues, named: string | undefined): Promise<Utxo> {
    const name = definition.inputs?.[input]?.name ?? input;
    const lockingBytecode = templateLockingBytecode(definition, wanted.lockingScript, values);
    const fits = (output: Output): boolean => {
      const { token } = wanted;
      if (hex(output.lockingBytecode) !== hex(lockingBytecode)) return false;
      if (token === undefined) return true;
      if (output.token === undefined) return false;
      if (token.category !== undefined && hex(output.token.category) !== token.category) return false;
      if (token.capability !== undefined && output.token.nft?.capability !== token.capability) return false;
      return token.commitment === undefined || hex(output.token.nft?.commitment ?? new Uint8Array()) === token.commitment;
    };
    if (named !== undefined) {
      const [transactionId = '', index = ''] = named.split(':');
      if (!/^[0-9a-f]{64}$/.test(transactionId) || !/^\d{1,5}$/.test(index)) return refuse(`The request names the coin for "${name}" in a form this wallet does not read.`);
      const unspent = (await this.wallet.chain.listUnspent(lockingBytecode)).some((listed) => listed.transactionId === transactionId && listed.index === Number(index));
      if (!unspent) return refuse(`The coin the request names for "${name}" is not unspent at the script the template gives it.`);
      // Only the named coin's own transaction is read: a contract every user shares can hold many coins.
      const text = await this.wallet.chain.getTransaction(transactionId);
      const transaction = text === undefined ? undefined : decodeTransactionBch(hexToBin(text));
      const output = transaction === undefined || typeof transaction === 'string' ? undefined : transaction.outputs[Number(index)];
      if (output === undefined || !fits(output)) return refuse(`The coin the request names for "${name}" is not what the template's declaration says is spent there.`);
      return { transactionHash: hexToBin(transactionId), index: Number(index), output };
    }
    const candidates = (await coinsAt(this.wallet.chain, lockingBytecode, wanted.token?.category)).filter((coin) => fits(coin.output)).sort((a, b) => (outpointOf(a) < outpointOf(b) ? -1 : 1));
    const [first] = candidates;
    return first ?? refuse(`The wallet finds no coin for "${name}" on chain: none is unspent at the script the template gives it.`);
  }

  /**
   * Evaluate each input of the application's in the virtual machine, against the transaction as worked out.
   * The wallet's own inputs stand in with placeholders: the contracts read what is spent and what is paid, and
   * the key holder's signatures are checked again, with everything else, before anything is sent.
   */
  private evaluateApplicationInputs(definition: ReadTemplate['definition'], inputs: PlannedInput[], outputs: PlannedOutput[], locktime: number): void {
    if (!inputs.some((input) => input.kind === 'application')) return;
    const transaction = {
      version: 2,
      locktime,
      inputs: inputs.map((input) => ({ outpointTransactionHash: input.coin.utxo.transactionHash, outpointIndex: input.coin.utxo.index, sequenceNumber: input.sequence ?? 0, unlockingBytecode: input.unlocking ?? PLACEHOLDER_UNLOCKING })),
      outputs: outputs.map(({ output }) => output),
    };
    const sourceOutputs = inputs.map((input) => input.coin.utxo.output);
    for (const [index, input] of inputs.entries()) {
      if (input.kind !== 'application') continue;
      const verdict = vm.stateSuccess(vm.evaluate({ inputIndex: index, sourceOutputs, transaction }));
      if (verdict !== true) {
        return refuse(`The application's own contract, "${definition.inputs?.[input.inputIdentifier ?? '']?.name ?? input.inputIdentifier}" at input ${index}, does not accept the transaction the wallet worked out: ${verdict}. A value the application gave may be wrong. Nothing was signed.`);
      }
    }
  }

  /** Whether a token that an output of a planned transaction creates leads, by the declaration, to an output of the same transaction. */
  private leadsToPosition(definition: ReadTemplate['definition'], entry: AuthorityEntry, planned: PlannedOutput[], tokenIndex: number): boolean {
    const nft = planned[tokenIndex]?.output.token;
    if (nft?.nft === undefined) return false;
    const token: TokenOnChain = { category: nft.category, commitment: nft.nft.commitment, capability: nft.nft.capability };
    const place = entry.position;
    try {
      if (!isCompanionPosition(place)) {
        const expected = hex(templateLockingBytecode(definition, place.lockingScript, valuesFrom(definition, place.variables, { token })));
        return planned.some(({ output }) => hex(output.lockingBytecode) === expected);
      }
      const companionAt = hex(templateLockingBytecode(definition, place.companion.lockingScript, valuesFrom(definition, place.companion.variables ?? {}, { token })));
      return planned.some(({ output: companion }, index) => {
        const target = planned[index + place.relative]?.output;
        if (hex(companion.lockingBytecode) !== companionAt || companion.token === undefined || hex(companion.token.category) !== hex(token.category) || target === undefined) return false;
        if (place.companion.commitment !== undefined && hex(companion.token.nft?.commitment ?? new Uint8Array()) !== place.companion.commitment) return false;
        const expected = templateLockingBytecode(definition, place.genuine.lockingScript, valuesFrom(definition, place.genuine.variables, { token, companion, position: target }));
        const wanted = place.genuine.tokenCategory === undefined ? undefined : place.genuine.tokenCategory === 'token.category' ? hex(token.category) : place.genuine.tokenCategory;
        return hex(expected) === hex(target.lockingBytecode) && (wanted === undefined || (target.token !== undefined && hex(target.token.category) === wanted));
      });
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return false;
    }
  }

  /**
   * What an action would do, for the user to decide on. Nothing is stored, signed or sent, and no address is taken.
   *
   * @throws ActionRefusedError with the reason when the wallet would not carry the action out;
   * InsufficientFundsError, with the figures, when the wallet's coins do not cover it
   */
  async preview(request: ApplicationAction): Promise<ActionPreview> {
    this.wallet.requireUsable();
    const { template, declaration, kept } = this.templateOf(request);
    const summary = this.summary(template, declaration, kept);
    const plan = await this.plan(request);
    const { definition } = template;
    const action = definition.actions?.[request.action];
    const transaction = definition.transactions?.[action?.transaction ?? ''];
    const declaredVariables = action?.roles?.[request.role]?.requirements?.variables ?? [];
    const ours = plan.inputs.filter((input) => input.kind !== 'application');
    const theirs = plan.inputs.filter((input) => input.kind === 'application');
    const toWallet = plan.outputs.filter(({ wallet }) => wallet !== undefined);
    const gives = sum(ours.map((input) => input.coin.utxo.output.valueSatoshis));
    const gets = sum(toWallet.map(({ output }) => output.valueSatoshis));
    const outputName = (identifier: string | undefined): string => definition.outputs?.[identifier ?? '']?.name ?? identifier ?? 'Output';
    // Tokens destroyed: what goes to a data output, and what the application's coins carry that no output carries on.
    const walletIn = ours.flatMap(({ coin }) => (coin.utxo.output.token === undefined ? [] : [coin.utxo.output.token]));
    const destroyed: ActionPreview['figures']['tokensDestroyed'] = plan.outputs
      .filter(({ output }) => isDataOutput(output) && output.token !== undefined)
      .map(({ output, identifier }) => {
        const burned = output.token as NonNullable<Output['token']>;
        const wallet = burned.nft === undefined ? walletIn.some((token) => hex(token.category) === hex(burned.category) && token.nft === undefined) : walletIn.some((token) => sameToken(token, burned));
        return { name: outputName(identifier), token: tokenMoved(burned), how: 'data output' as const, wallet };
      });
    const carried = plan.outputs.flatMap(({ output }) => (output.token === undefined ? [] : [output.token]));
    for (const input of theirs) {
      const nft = input.coin.utxo.output.token;
      if (nft?.nft !== undefined && !carried.some((token) => hex(token.category) === hex(nft.category) && token.nft?.capability === nft.nft?.capability && hex(token.nft?.commitment ?? new Uint8Array()) === hex(nft.nft?.commitment ?? new Uint8Array()))) {
        destroyed.push({ name: definition.inputs?.[input.inputIdentifier ?? '']?.name ?? input.inputIdentifier ?? 'Input', token: tokenMoved({ ...nft, amount: 0n }), how: 'not carried on', wallet: false });
      }
    }
    const fungibleOut = fungible(plan.outputs.map(({ output }) => output));
    for (const [category, amount] of fungible(plan.inputs.map(({ coin }) => coin.utxo.output))) {
      const lost = amount - (fungibleOut.get(category) ?? 0n);
      if (lost > 0n) destroyed.push({ name: 'Tokens not carried on', token: { category, amount: lost }, how: 'not carried on', wallet: false });
    }
    const walletFungibleIn = fungible(ours.map(({ coin }) => coin.utxo.output));
    const walletFungibleOut = fungible(toWallet.map(({ output }) => output));
    const tokensNet = [...new Set([...walletFungibleIn.keys(), ...walletFungibleOut.keys()])].map((category) => ({ category, amount: (walletFungibleOut.get(category) ?? 0n) - (walletFungibleIn.get(category) ?? 0n) })).filter(({ amount }) => amount !== 0n);
    return {
      template: summary,
      words: {
        action: { name: action?.name ?? request.action, description: action?.description ?? '' },
        outcome: templateWords(definition, transaction?.description, plan.values),
        values: declaredVariables.flatMap((variable) => {
          const value = plan.values[variable];
          const described = definition.variables?.[variable];
          return value === undefined ? [] : [{ name: described?.name ?? variable, description: described?.description ?? '', value: String(value) }];
        }),
      },
      figures: {
        givesSatoshis: gives,
        getsSatoshis: gets,
        feeSatoshis: plan.feeSatoshis,
        remainderSatoshis: plan.remainderSatoshis,
        bytes: plan.bytes,
        intoApplicationSatoshis: gives - gets - plan.feeSatoshis,
        fromApplication: { satoshis: sum(theirs.map((input) => input.coin.utxo.output.valueSatoshis)), coins: theirs.length },
        applicationInputs: theirs.map((input) => ({ ...moved(input.coin.utxo.output), name: definition.inputs?.[input.inputIdentifier ?? '']?.name ?? input.inputIdentifier ?? 'Input', outpoint: outpointOf(input.coin.utxo) })),
        toOthers: plan.outputs.filter(({ wallet }) => wallet === undefined).map(({ output, identifier }) => ({ ...moved(output), name: outputName(identifier), lockingBytecode: hex(output.lockingBytecode) })),
        toWallet: toWallet.map(({ output, wallet }) => ({ ...moved(output), kind: wallet as WalletOutputKind })),
        tokensSpent: ours.filter((input) => input.coin.utxo.output.token !== undefined).map((input) => moved(input.coin.utxo.output)),
        tokensNet,
        tokensDestroyed: destroyed,
        ...(plan.locktime === 0 ? {} : { notBefore: plan.locktime }),
        ...(plan.payItself === undefined ? {} : { payingItself: { feeSatoshis: await this.wallet.quotePayItself(plan.payItself) } }),
      },
      firstUse: kept?.stored !== true,
    };
  }

  // ------------------------------------------------------------------ carrying an action out

  /** What the key holder built has to be the transaction that was worked out and shown. */
  private check(plan: Plan, prepared: PreparedTransaction): void {
    const transaction = decodeTransactionBch(hexToBin(prepared.transactionHex));
    if (typeof transaction === 'string') throw new Error(`What was built is not a transaction: ${transaction}`);
    const differs = (what: string): never => {
      throw new Error(`The transaction that was built differs from the one the wallet worked out and showed: ${what}. Nothing was sent.`);
    };
    if (transaction.locktime !== plan.locktime) differs('its lock time');
    if (transaction.outputs.length !== plan.outputs.length) differs('the number of its outputs');
    plan.outputs.forEach(({ output }, index) => {
      if (!sameOutput(output, transaction.outputs[index] as Output)) differs(`output ${index}`);
    });
    if (transaction.inputs.length !== plan.inputs.length) differs('the number of its inputs');
    plan.inputs.forEach((input, index) => {
      const built = transaction.inputs[index];
      if (built === undefined || hex(built.outpointTransactionHash) !== hex(input.coin.utxo.transactionHash) || built.outpointIndex !== input.coin.utxo.index) return differs(`input ${index}`);
      if (input.kind === 'application' && (built.sequenceNumber !== input.sequence || hex(built.unlockingBytecode) !== hex(input.unlocking ?? new Uint8Array()))) differs(`how input ${index} is unlocked`);
      return undefined;
    });
  }

  /**
   * Carry out an action: the user has agreed to it. For a template that is new to the wallet this trusts
   * the template, and stores it in the backup before anything is signed.
   *
   * @param onStage - `recorded`: the backup holds the template. `sent`: the transaction is on the network.
   * @throws NotStoredError when no backup store confirms a new template; ActionRefusedError; InsufficientFundsError
   */
  async carryOut(request: ApplicationAction, onStage: (stage: 'recorded' | 'sent') => void = () => undefined): Promise<ActionOutcome> {
    this.wallet.requireUsable();
    // Everything that can refuse the action does so before the template is taken in.
    await this.plan(request);
    const kept = await this.ensureStored(await this.trust(request.template, request.presented, request.application));
    onStage('recorded');
    const identifier = await this.wallet.backend.importTemplate(kept.text);
    if (identifier !== kept.identifier) throw new Error('The key holder gives the template another identifier than the one it was trusted under.');

    let plan = await this.plan(request);
    if (plan.payItself !== undefined) {
      const { coin } = await this.wallet.payItself(plan.payItself);
      plan = await this.plan(request, coin);
    }
    await this.wallet.hold(plan.reserved);
    let prepared: PreparedTransaction;
    try {
      await this.follow(plan);
      prepared = await this.wallet.prepare({
        template: identifier,
        action: plan.action,
        role: plan.role,
        variables: plan.values,
        inputs: plan.inputs.map(({ coin, inputIdentifier, given, unlocking, sequence }) => ({
          coin,
          ...(inputIdentifier === undefined ? {} : { inputIdentifier }),
          ...(given === true ? { unlocking: { bytecode: unlocking as Uint8Array, sequenceNumber: sequence ?? 0 } } : {}),
        })),
        outputs: plan.outputs.map(({ output, identifier: outputIdentifier, wallet }) => (outputIdentifier === undefined || wallet === 'left over' ? output : { outputIdentifier })),
      });
      try {
        this.check(plan, prepared);
      } catch (error) {
        await this.wallet.backend.discard(prepared.invitationIdentifier);
        throw error;
      }
    } catch (error) {
      // Nothing was sent and no signature left the wallet: the addresses may be used for something else.
      this.wallet.giveBack(plan.reserved);
      throw error;
    }
    try {
      await this.wallet.send(prepared);
    } finally {
      // Whether or not the network took it, a signature that names these addresses has left the wallet.
      this.wallet.keep(plan.used);
      this.wallet.giveBack(plan.reserved.filter((entry) => !plan.used.includes(entry)));
    }
    onStage('sent');

    // Notes on the tokens made: a convenience, never an authority. A note that cannot be written is not missed.
    const notes = plan.created.flatMap(({ category, authority }) => (authority === undefined ? [] : [{ category, templateIdentifier: identifier, authority }]));
    if (notes.length > 0) {
      this.change({ notes: [...this.state.notes.filter((note) => !notes.some((made) => made.category === note.category)), ...notes] });
      for (const note of notes) await this.options.archive?.write({ kind: 'token-note', ...note }).catch(() => undefined);
    }
    if (plan.position !== undefined && kept.positionFound !== true) this.updateTemplate(identifier, { positionFound: true });
    const received = plan.outputs.filter(({ output, wallet }) => wallet !== undefined && output.token !== undefined);
    return {
      transactionId: prepared.transactionId,
      builtAs: prepared.invitationIdentifier,
      sent: { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: plan.remainderSatoshis },
      tokens: received.map(({ output }) => ({
        category: hex(output.token?.category ?? new Uint8Array()),
        commitment: hex(output.token?.nft?.commitment ?? new Uint8Array()),
        capability: output.token?.nft?.capability ?? 'none',
        satoshis: String(output.valueSatoshis),
        ...(output.token?.amount === undefined || output.token.amount === 0n ? {} : { amount: String(output.token.amount) }),
      })),
    };
  }

  /** Make the scripts of the application's coins known to the key holder, and wait until it lists the coins there. */
  private async follow(plan: Plan): Promise<void> {
    if (plan.follow.length === 0) return;
    for (const script of plan.follow) await this.wallet.backend.followScript(script);
    const wanted = plan.inputs.filter((input) => input.kind === 'application' && input.given !== true).map((input) => outpointOf(input.coin.utxo));
    for (let attempt = 0; attempt < 240; attempt++) {
      const listed = new Set((await this.wallet.backend.coins()).map((coin) => outpointOf(coin.utxo)));
      if (wanted.every((place) => listed.has(place))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The key holder does not see the coins the action spends. Try again in a moment.');
  }

  // ------------------------------------------------------------------ tokens and positions

  /**
   * Take in what the backup holds about applications: templates and token notes. A template that this seed
   * stored is trusted, as it was when it was stored. One that an earlier owner stored is a suggestion from
   * that time and is not trusted here (section 10.3). Notes are hints either way.
   */
  async readBackup(): Promise<{ suggested: number; notes: number }> {
    const { archive } = this.options;
    if (archive === undefined) return { suggested: 0, notes: 0 };
    const { templates, tokenNotes } = await archive.read();
    const suggested = [...(this.state.suggested ?? [])];
    for (const { entry, standing } of templates) {
      const names: TemplateNames = { identifier: entry.identifier, contentHash: entry.contentHash, ...(entry.declaration === undefined ? {} : { declaration: entry.declaration.contentHash }) };
      const texts: PresentedTexts = { template: entry.text, ...(entry.declaration === undefined ? {} : { declaration: entry.declaration.text }), ...(entry.references === undefined ? {} : { references: entry.references.map((reference) => reference.text) }) };
      if (this.keptTemplate(names) !== undefined) continue;
      try {
        if (standing === 'current owner') {
          await this.trust(names, texts);
          this.updateTemplate(names.identifier, { stored: true });
        } else if (!suggested.some((known) => known.identifier === names.identifier && known.contentHash === names.contentHash)) {
          suggested.push({ ...names, name: readPresented(names, texts).template.definition.name ?? 'Unnamed template', texts });
        }
      } catch {
        // A record that cannot be read as a template is passed over: it is a hint, and a bad one.
      }
    }
    const notes = [...this.state.notes];
    for (const { entry } of tokenNotes) {
      if (!notes.some((note) => note.category === entry.category)) notes.push({ category: entry.category, templateIdentifier: entry.templateIdentifier, authority: entry.authority });
    }
    this.change({ suggested, notes });
    return { suggested: this.suggestions.length, notes: notes.length };
  }

  /**
   * Every token the wallet holds, with what the wallet knows about it. A token is never left out: one whose
   * meaning cannot be worked out is listed as such (sections 10.4 and 14.3).
   */
  async tokens(): Promise<HeldToken[]> {
    const held: HeldToken[] = [];
    const kept = this.state.templates.map((template) => ({ kept: template, ...this.read(template) }));
    for (const { coin, place } of await this.wallet.tokenCoins()) {
      const token = coin.utxo.output.token as NonNullable<Output['token']>;
      const category = hex(token.category);
      const base = { category, commitment: hex(token.nft?.commitment ?? new Uint8Array()), ...(token.nft === undefined ? {} : { capability: token.nft.capability }), amount: token.amount, place };
      const onChain = tokenOf(coin);
      const note = this.state.notes.find((candidate) => candidate.category === category);
      const candidates = note === undefined ? kept : kept.filter((template) => template.kept.identifier === note.templateIdentifier);
      if (onChain === undefined) {
        held.push({ ...base, meaning: 'unknown' });
        continue;
      }
      if (note !== undefined && candidates.length === 0) {
        const suggested = this.suggestions.find((template) => template.identifier === note.templateIdentifier);
        held.push({
          ...base,
          meaning: 'incomplete',
          reason:
            suggested === undefined
              ? 'A note says which template made this token, and that template is not on this device. The token is safe; what it controls cannot be shown or operated until the template is had again.'
              : `A note says the template "${suggested.name}" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet.`,
          ...(suggested === undefined ? {} : { template: { identifier: suggested.identifier, name: suggested.name } }),
        });
        continue;
      }
      let refusedNote: string | undefined;
      /** Try the token against templates: the one a note names, or every template the user trusts. */
      const look = async (templates: typeof kept, hint: TokenNote | undefined): Promise<HeldToken | undefined> => {
        for (const { kept: template, template: read, declaration } of templates) {
          if (declaration === undefined) continue;
          for (const [name, entry] of Object.entries(declaration.declaration.authority)) {
            if (hint !== undefined && hint.authority !== name) continue;
            const capability = read.definition.outputs?.[entry.token]?.token?.nft?.capability;
            if (capability !== undefined && !capability.startsWith('$(') && capability !== onChain.capability) continue;
            const found = await findPosition(this.wallet.chain, read.definition, entry, onChain);
            if (found.status === 'not found') {
              // The rebuild check (section 10.4): a note that leads nowhere on chain is not used.
              if (hint !== undefined) refusedNote = `A note said that the template "${template.name}" made this token. ${found.note ?? ''} The note is not used.`;
              continue;
            }
            // Without a note, a position that cannot be worked out does not show that the token is of this template.
            if (found.status === 'incomplete' && hint === undefined) continue;
            if (template.positionFound !== true && (found.status === 'open' || found.status === 'closed')) this.updateTemplate(template.identifier, { positionFound: true });
            return {
              ...base,
              meaning: found.status === 'incomplete' ? 'incomplete' : 'position',
              ...(found.status === 'incomplete' && found.note !== undefined ? { reason: found.note } : {}),
              template: { identifier: template.identifier, name: template.name },
              authority: name,
              position: {
                status: found.status,
                ...(found.note === undefined ? {} : { note: found.note }),
                satoshis: sum(found.coins.map((position) => position.output.valueSatoshis)),
                coins: found.coins.length,
                ...(found.lockingBytecode === undefined ? {} : { lockingBytecode: hex(found.lockingBytecode) }),
                ...(found.status === 'open' && entry.state !== undefined ? { state: positionState(read.definition, entry, found, onChain) } : {}),
              },
              actions: entry.actions.flatMap((action) => {
                const described = read.definition.actions?.[action];
                const [role] = Object.keys(described?.roles ?? {});
                return described === undefined || role === undefined ? [] : [{ action, role, name: described.name ?? action, description: described.description ?? '', ...offered(read.definition, declaration.declaration, action, role) }];
              }),
            };
          }
        }
        return undefined;
      };
      // A note is a hint. When it leads nowhere, the token is tried against every template the user trusts.
      const match = (await look(candidates, note)) ?? (note === undefined ? undefined : await look(kept, undefined));
      held.push(match === undefined ? { ...base, meaning: 'unknown', ...(refusedNote === undefined ? {} : { reason: refusedNote }) } : { ...match, ...(refusedNote === undefined ? {} : { noteRefused: refusedNote }) });
    }
    return held;
  }

  /**
   * The tokens of one template the wallet holds, with where each position stands, read from the chain.
   *
   * @param application - the application that asks. It is answered only for a template the user trusted in a session with it.
   * @returns `undefined` when the template is not trusted, or not with this application
   */
  async positions(templateIdentifier: string, application?: string): Promise<HeldToken[] | undefined> {
    const kept = this.state.templates.find((template) => template.identifier === templateIdentifier);
    if (kept === undefined || (application !== undefined && !kept.applications.includes(application))) return undefined;
    return (await this.tokens()).filter((token) => token.template?.identifier === templateIdentifier && token.meaning !== 'unknown');
  }

  /**
   * Whether an application that asks about a template's tokens is one the user could let see them: the template
   * is trusted on this device, and not yet in a session with that application. Its answer is the user's to give.
   */
  mayAllow(templateIdentifier: string, application: string): boolean {
    const kept = this.state.templates.find((template) => template.identifier === templateIdentifier);
    return kept !== undefined && !kept.applications.includes(application);
  }

  /**
   * Let an application see the tokens of a template the user trusts, as if the template had been trusted in a
   * session with it. On the user's word only.
   */
  allow(templateIdentifier: string, application: string): KeptTemplate {
    const kept = this.state.templates.find((template) => template.identifier === templateIdentifier);
    if (kept === undefined) return refuse('This wallet does not trust that template.');
    return kept.applications.includes(application) ? kept : this.updateTemplate(kept.identifier, { applications: [...kept.applications, application] });
  }

  /**
   * An action on a position, as the user asks for it from the wallet itself, with the application's site not
   * consulted: everything comes from the token, the template and the chain.
   */
  actionOn(token: Pick<HeldToken, 'category' | 'template'>, action: string, variables: Record<string, string | number> = {}): ApplicationAction {
    const kept = this.state.templates.find((template) => template.identifier === token.template?.identifier);
    if (kept === undefined) return refuse('The template of this token is not trusted on this device.');
    const described = this.read(kept).template.definition.actions?.[action];
    const [role] = Object.keys(described?.roles ?? {});
    if (role === undefined) return refuse(`The template "${kept.name}" has no action "${action}".`);
    return {
      template: { identifier: kept.identifier, contentHash: kept.contentHash, ...(kept.declaration === undefined ? {} : { declaration: kept.declaration.contentHash }) },
      action,
      role,
      variables,
      tokens: [token.category],
    };
  }
}
