import { type Output, binToHex, createVirtualMachineBch2026, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
import {
  type PositionRecordEntry,
  type PositionToken,
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
  templateExpression,
  templateWords,
  transactionBytes,
  typedValues,
  variableType,
} from '@grandmas-wallet/core';

import { TYPEABLE, actionShape, applicationInputs, offeredAt, paysTo, spendingInputs } from './action-shape.js';
import { type ActionEntry, type ApplicationInput, type AuthorityEntry, type BindingKind, type ReadDeclaration, type RecoveryDeclaration, BINDING_KINDS, isCompanionPosition, readDeclaration } from './declaration.js';
import type { ReservedAddress, Sent, TokenCoin, WalletParts } from './owner-wallet.js';
import { type FoundPosition, type PositionStatus, type TokenOnChain, coinsAt, findPosition, valuesFrom } from './positions.js';
import { type RecoveryArrangement, type StoreAt, writeRecord } from './recovery-flow.js';
import { type PositionRecordCheck, type PositionRecordVerdict, checkPositionRecord, recordsDue, samePosition, sameRecord, sameNft } from './position-records.js';
import { type PresentedTexts, type TemplateNames, type Verdict, checkTemplate, readPresented } from './template-check.js';
import { type NameClaim, type TokenNaming, TokenNames } from './token-names.js';

/**
 * Applications (proposal sections 12 to 14): carrying out an action of a template the wallet has never
 * seen, with the wallet's own coins and addresses; saying what a template is and what the wallet could
 * check about it; and finding, from the tokens the wallet holds, the positions they control.
 *
 * Nothing here knows any application. Everything the wallet does for one comes from the application's
 * template and the request, with either the template's recovery declaration (the second design) or, for a
 * template that comes with nothing beside it, the wallet's own position records (section 13.3).
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
  /**
   * A record of a position made with the template, written by an earlier seed, has been confirmed by the chain
   * (section 10.4): the template has come back once (section 14.3).
   */
  cameBack?: boolean;
  /** How many times the user had stopped trusting it before this trust. The backup's record of it carries the same number. */
  renewal?: number;
}

/** Which template made a token, and which authority entry of its declaration the token stands for. A hint, checked before use. */
export interface TokenNote {
  category: string;
  templateIdentifier: string;
  authority: string;
}

/**
 * A template the backup holds that is not trusted here: one an earlier owner of the wallet stored, or one
 * the user stopped trusting. It is a suggestion.
 */
export interface SuggestedTemplate extends TemplateNames {
  name: string;
  texts: PresentedTexts;
  /**
   * The user of this seed stopped trusting it; the backup still holds it. `renewal` is the number of that
   * withdrawal, and `stored` whether a backup store has confirmed the withdrawal's record.
   */
  withdrawn?: { renewal: number; stored: boolean };
}

export interface ApplicationsState {
  templates: KeptTemplate[];
  notes: TokenNote[];
  suggested?: SuggestedTemplate[];
  /**
   * Records of positions that this seed's actions left, each confirmed by a backup store before the action's
   * signature left the wallet (section 10.5), and records of an earlier seed that the chain has borne out and
   * that this seed has written again as its own (section 10.6).
   */
  positionRecords?: PositionRecordEntry[];
  /** Records of positions that an earlier seed wrote: suggestions, until the chain bears them out (section 10.6). */
  suggestedRecords?: PositionRecordEntry[];
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
   * For a template that comes with no declaration: the position the action is about, by the category of the
   * wallet's token, and whether the action spends that token. Paying into a position is about its token and does
   * not spend it. Where the template gives the token an input of its own, an action whose transaction has that
   * input spends it, whatever this says.
   */
  about?: { category: string; spent: boolean };
  /**
   * Set when the wallet acts by itself, from its own list of positions, with no request: `typed` holds what the
   * user typed. A value is then taken from the user only after the record and the wallet itself, and only for
   * a value a person can type; anything else missing is the application's to give.
   */
  fromWallet?: { typed: Record<string, string | number> };
  /**
   * Coins of the application the action is to spend, by template input, as `<transaction id>:<output index>`:
   * the page's choice among the contracts every user of the application shares. The wallet reads each from
   * the chain and checks it against the template's declaration; an input the request does not name, the
   * wallet finds itself.
   */
  inputs?: Record<string, string>;
  /** The application that asks, by the name of its pairing. Absent when the user acts from the wallet itself. */
  application?: string;
  /** The address of the application's page, where the request came from one. It goes into the position's record. */
  page?: string;
}

/** The backup archive, as far as templates, token notes and position records need it. */
export interface ApplicationArchive {
  write(entry: RecordEntry): Promise<WriteResult>;
  /** The templates, notes and position records in the archive, each with whose it is: the current owner's, or an earlier one's. */
  read(): Promise<{
    templates: { entry: TemplateEntry; standing: Standing; withdrawn?: number }[];
    tokenNotes: { entry: TokenNoteEntry; standing: Standing }[];
    positions?: { entry: PositionRecordEntry; standing: Standing }[];
  }>;
}

/** The archive in use of a recovery arrangement, for templates, token notes and position records. */
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
      return { templates: assessment.templates, tokenNotes: assessment.tokenNotes, positions: assessment.positions };
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
  /**
   * The template has come back once: a token made with it has led to its position after a recovery, through a
   * record that the chain confirmed (section 14.3). It says nothing about an audit of its contracts.
   */
  cameBack?: true;
  /**
   * The user trusts this template on this device with another recovery declaration than the one presented now.
   * Approving takes the presented one in its place, on the user's word, as for a template met for the first time.
   */
  replacesDeclaration?: boolean;
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
  /**
   * The action leaves a position, or gives the wallet an NFT: its record will be stored in the backup before
   * anything is signed, and the action is refused if no store confirms it (section 10.5).
   */
  recordsPosition?: boolean;
  /**
   * The action is at a position that is not confirmed (section 10.4), with the reason. It is carried out only
   * because the wallet's own figures show that the wallet gives nothing but the fee.
   */
  notConfirmed?: string;
  /**
   * Tokens that the action does not deliver to the wallet unchanged (section 13.3): the token of the wallet's it
   * spends, where it leaves the wallet, comes back changed or ends; and a token made from the wallet's own coin
   * that goes elsewhere. The action is carried out only with the user's tick: `carryOut` with `{ tokensLeave: true }`.
   */
  tokensLeaving?: TokenLeaving[];
}

/**
 * A token that an action does not deliver to the wallet unchanged.
 *
 * - `leaves`: an output that is not the wallet's carries it, as it is or changed.
 * - `changes`: it comes back to the wallet with another commitment or capability.
 * - `ends`: no output carries it on, or a data output does.
 */
export interface TokenLeaving {
  token: PositionToken & { amount?: bigint };
  how: 'leaves' | 'changes' | 'ends';
  /** The token is made now, from the wallet's own coin. */
  made?: true;
  /** The template's name for the output it goes to. */
  to?: string;
}

/** What the user agreed to beside the action itself. */
export interface ActionConsent {
  /** The user's tick for tokens the action does not deliver to the wallet unchanged (`ActionPreview.tokensLeaving`). */
  tokensLeave?: boolean;
}

/** The action would not deliver a token to the wallet unchanged, and the user has not ticked that this is what they want. */
export class TickNeededError extends ActionRefusedError {
  constructor(
    message: string,
    readonly tokensLeaving: TokenLeaving[],
  ) {
    super(message);
    this.name = 'TickNeededError';
  }
}

/**
 * The wallet does not carry the action out by itself: it needs something that only the application gives, a
 * coin of the application's or a value it works out (section 13.3). It is done through the application, whose
 * page the record names where there is one.
 */
export class NeedsApplicationError extends ActionRefusedError {
  constructor(
    reason: string,
    readonly page?: string,
  ) {
    super(`Open the application to do this${page === undefined ? '' : `: ${page}`}. ${reason}`);
    this.name = 'NeedsApplicationError';
  }
}

/**
 * Where a position stands, as the wallet's records and the chain say (sections 10.4 and 14.2):
 *
 * - `open`: a record that counts, and its script holds coins.
 * - `closed`: a record that counts, and its script holds nothing.
 * - `unconfirmed`: a record that does not count; or one of several records that count for one token while
 *   more than one of their scripts holds coins.
 * - `held`: a record that names no script counts. The token is the template's; whether the position is open
 *   is the application's to say.
 */
export type RecordedStatus = 'open' | 'closed' | 'unconfirmed' | 'held';

/** A position the wallet lists from its records: an NFT it holds, and the record that ties it to a position. */
export interface RecordedPosition {
  /** The NFT, as the wallet holds it now. */
  token: PositionToken & { outpoint: string; satoshis: bigint; place: TokenCoin['place'] };
  template: { identifier: string; name?: string };
  status: RecordedStatus;
  /** Why the position is not confirmed. */
  reason?: string;
  record: PositionRecordEntry;
  /** `own`: a record of this seed's; `suggested`: one an earlier seed wrote. */
  standing: 'own' | 'suggested';
  /** For a record that names a script: the script, as hex, and what it holds now. */
  lockingBytecode?: string;
  satoshis?: bigint;
  coins?: number;
  /** The actions the template offers the record's role at its script. */
  actions?: string[];
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
  /** For an action done through the application: the address of its page, as the position's record names it. */
  page?: string;
}

/** A token the wallet holds, with what the wallet knows about it. */
export interface HeldToken {
  category: string;
  commitment: string;
  capability?: 'none' | 'mutable' | 'minting';
  amount: bigint;
  place: TokenCoin['place'];
  /** The coin, as `<transaction id>:<output index>`. */
  outpoint: string;
  /** The satoshis the coin holds under its token. */
  satoshis: bigint;
  /** What trusted templates call the coin's tokens: its fungible amount, and its NFT. */
  names?: { fungible?: TokenNaming; nft?: TokenNaming };
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
  /** Tokens of the wallet's, or made from its coin, that the action does not deliver to it unchanged: carried out only with the user's tick. */
  tokensLeaving?: TokenLeaving[];
  /** The position record the action took values from. */
  record?: PositionRecordEntry;
}

/** What the first half of working an action out leaves for the second. */
interface Frame {
  template: ReadTemplate;
  role: string;
  action: string;
  /** The template's inputs of the action's transaction, in the template's order. */
  inputOrder: string[];
  values: TemplateValues;
  kinds: (1 | 2)[];
  reserved: ReservedAddress[];
  leftOver: ReservedAddress;
  walletScripts: Map<string, WalletOutputKind>;
  /** The variable that receives the category of the token the action creates. */
  creates?: string;
  applicationCoins: { input: string; index?: number; utxo: Utxo; lockingScript: string }[];
  follow: Map<string, FollowedScript>;
  following: Map<string, string>;
  /** The token of the wallet's the action is about. */
  token?: TokenCoin;
  /** Whether the action spends that token. */
  spends: boolean;
  /** The template's input for the token, where the template gives it one. */
  tokenInput?: { input: string; index?: number };
  position?: FoundPosition;
  /** For a template with a recovery declaration of the second design: what it says about the action. */
  declared?: { declaration: RecoveryDeclaration; entry: ActionEntry; fromToken: [string, string][] };
  record?: PositionRecordEntry;
}

/** The NFT of an output, compared whole: category, capability, commitment. */
const nftOf = (token: Output['token']): PositionToken | undefined =>
  token?.nft === undefined ? undefined : { category: hex(token.category), commitment: hex(token.nft.commitment), capability: token.nft.capability };

/**
 * What becomes of the wallet's tokens in a transaction as worked out (section 13.3): the token the action spends
 * has to come back to an address of the wallet's unchanged; a token made from the wallet's coin that does not come
 * to the wallet goes to the application, or elsewhere. Either is shown, and asks for the user's tick.
 */
const leavingTokens = (definition: ReadTemplate['definition'], planned: PlannedOutput[], spent: TokenCoin | undefined, made: string | undefined): TokenLeaving[] => {
  const leaving: TokenLeaving[] = [];
  const outputName = (identifier: string | undefined): string | undefined => (identifier === undefined ? undefined : (definition.outputs?.[identifier]?.name ?? identifier));
  const own = spent === undefined ? undefined : nftOf(spent.coin.utxo.output.token);
  if (own !== undefined && !planned.some(({ output, wallet }) => wallet !== undefined && sameNft(nftOf(output.token), own))) {
    const ofCategory = planned.filter(({ output }) => output.token?.nft !== undefined && hex(output.token.category) === own.category && !isDataOutput(output));
    const away = ofCategory.find(({ wallet }) => wallet === undefined);
    const to = outputName((away ?? ofCategory[0])?.identifier);
    leaving.push({ token: own, how: away !== undefined ? 'leaves' : ofCategory.length > 0 ? 'changes' : 'ends', ...(to === undefined ? {} : { to }) });
  }
  if (made !== undefined) {
    for (const { output, wallet, identifier } of planned) {
      if (wallet !== undefined || output.token === undefined || hex(output.token.category) !== made) continue;
      const to = outputName(identifier);
      leaving.push({
        token: { category: made, commitment: hex(output.token.nft?.commitment ?? new Uint8Array()), capability: output.token.nft?.capability ?? 'none', ...(output.token.amount > 0n ? { amount: output.token.amount } : {}) },
        how: isDataOutput(output) ? 'ends' : 'leaves',
        made: true,
        ...(to === undefined ? {} : { to }),
      });
    }
  }
  return leaving;
};

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
      /**
       * The check of a position record against the chain (section 10.4); `checkPositionRecord` unless given. Only
       * a record of an earlier seed that it finds to count is written again as this seed's own, and only records
       * that count are listed as positions.
       */
      checkRecord?: PositionRecordCheck;
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

  /** The records of positions this seed holds as its own: written before its actions were signed, or borne out by the chain. */
  get positionRecords(): PositionRecordEntry[] {
    return this.state.positionRecords ?? [];
  }

  /** Records of positions an earlier seed wrote, which the chain has not borne out yet. They are suggestions. */
  get suggestedRecords(): PositionRecordEntry[] {
    return this.state.suggestedRecords ?? [];
  }

  /** Templates the backup holds which this device does not trust: an earlier owner's, or ones the user stopped trusting. */
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
  private templateOf(request: Pick<ApplicationAction, 'template' | 'presented'>): { template: ReadTemplate; declaration?: ReadDeclaration; kept?: KeptTemplate; texts?: PresentedTexts; replaces?: KeptTemplate } {
    const kept = this.keptTemplate(request.template);
    if (kept !== undefined) {
      if (kept.declaration?.contentHash !== request.template.declaration && request.template.declaration !== undefined) {
        // Another declaration for a template the user trusts: it is shown as a template is the first time, and
        // taken in only on the user's word. Until then the wallet keeps working with the one it has.
        if (request.presented === undefined) return refuse('The request names another recovery declaration than the one this wallet trusted with the template. Send the template with the request.');
        const presented = readPresented(request.template, request.presented);
        return { template: presented.template, ...(presented.declaration === undefined ? {} : { declaration: presented.declaration }), texts: request.presented, replaces: kept };
      }
      return { ...this.read(kept), kept };
    }
    if (request.presented === undefined) return refuse('This wallet does not have that template. Send the template with the request.');
    const presented = readPresented(request.template, request.presented);
    return { template: presented.template, ...(presented.declaration === undefined ? {} : { declaration: presented.declaration }), texts: request.presented };
  }

  private summary(template: ReadTemplate, declaration: ReadDeclaration | undefined, kept: KeptTemplate | undefined, replaces?: KeptTemplate): TemplateSummary {
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
      ...(kept?.cameBack === true ? { cameBack: true } : {}),
      ...(replaces === undefined ? {} : { replacesDeclaration: true }),
    };
  }

  /**
   * What a template is and what the wallet can say about it, without taking it in.
   * @throws PresentationError if it is not what the names say; UnknownProfileError for a declaration this wallet cannot read
   */
  describe(names: TemplateNames, presented?: PresentedTexts): TemplateSummary {
    const { template, declaration, kept, replaces } = this.templateOf({ template: names, ...(presented === undefined ? {} : { presented }) });
    return this.summary(template, declaration, kept, replaces);
  }

  /**
   * Trust a template on the user's word, and store it in the backup. Storing may fail; the template is then
   * trusted on this device and not yet stored, and no signature for one of its actions leaves the wallet.
   */
  async trust(names: TemplateNames, presented: PresentedTexts | undefined, application?: string): Promise<KeptTemplate> {
    let kept = this.keptTemplate(names);
    if (kept !== undefined && names.declaration !== undefined && kept.declaration?.contentHash !== names.declaration && presented !== undefined) {
      // Another declaration for a template the user trusts, approved by the user: it takes the earlier one's
      // place, and is stored in the backup before the next action.
      const read = readPresented(names, presented);
      const verdict = checkTemplate(read.template, read.declaration, kept.positionFound === true ? { positionFound: true } : {});
      if (verdict.statement === 'violation') {
        return refuse(`This wallet does not take the new recovery declaration in: ${verdict.violations.map((violation) => `${violation.rule === 'names' ? 'the names it gives tokens' : `rule ${violation.rule}`}: ${violation.what} ${violation.consequence}`).join(' ')}`);
      }
      kept = this.updateTemplate(kept.identifier, {
        ...(read.declaration === undefined ? {} : { declaration: { contentHash: read.declaration.contentHash, text: read.declaration.text } }),
        references: read.references,
        stored: false,
      });
    }
    if (kept === undefined) {
      const suggestion = this.suggestions.find((suggested) => suggested.identifier === names.identifier && suggested.contentHash === names.contentHash);
      const texts = presented ?? suggestion?.texts;
      if (texts === undefined) return refuse('This wallet does not have that template.');
      // Trust given again after it was withdrawn. Where the backup has the withdrawal, the template is stored
      // again under the next number, which the withdrawal does not reach; where it has not, nothing there changed.
      const withdrawn = suggestion?.withdrawn;
      const renewal = withdrawn === undefined ? 0 : withdrawn.stored ? withdrawn.renewal + 1 : withdrawn.renewal;
      const read = readPresented(names, texts);
      const verdict = checkTemplate(read.template, read.declaration);
      // The backup's record of the withdrawn trust serves again only if it is of the same declaration.
      const asStored = withdrawn !== undefined && !withdrawn.stored && read.declaration?.contentHash === suggestion?.declaration;
      if (verdict.statement === 'violation') {
        return refuse(`This wallet does not take the template in: ${verdict.violations.map((violation) => `${violation.rule === 'names' ? 'the names it gives tokens' : `rule ${violation.rule}`}: ${violation.what} ${violation.consequence}`).join(' ')}`);
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
        stored: asStored,
        ...(renewal === 0 ? {} : { renewal }),
      };
      this.change({
        templates: [...this.state.templates, kept],
        ...(withdrawn === undefined ? {} : { suggested: (this.state.suggested ?? []).filter((suggested) => !(suggested.identifier === names.identifier && suggested.contentHash === names.contentHash)) }),
      });
    }
    if (application !== undefined && !kept.applications.includes(application)) kept = this.updateTemplate(kept.identifier, { applications: [...kept.applications, application] });
    return kept;
  }

  /** The NFTs among the wallet's tokens that a request names: what the action is about. */
  private async named(request: Pick<ApplicationAction, 'tokens' | 'about'>): Promise<PositionToken[]> {
    const categories = new Set([...(request.tokens ?? []), ...(request.about === undefined ? [] : [request.about.category])]);
    if (categories.size === 0) return [];
    return (await this.wallet.tokenCoins()).flatMap(({ coin }) => {
      const { token } = coin.utxo.output;
      return token?.nft === undefined || !categories.has(hex(token.category)) ? [] : [{ category: hex(token.category), commitment: hex(token.nft.commitment), capability: token.nft.capability }];
    });
  }

  /**
   * The records an action leaves (section 10.2), from the template and the transaction as the wallet worked it
   * out, less what this seed's records already hold: the same record, or, for an action on a position whose
   * token the wallet already held, a record of the same position. Such an action, a payment into the position,
   * has values of its own; the record that made the position holds what acting on it takes.
   */
  private async recordsOf(plan: Plan, request: ApplicationAction): Promise<PositionRecordEntry[]> {
    const about = await this.named(request);
    const due = recordsDue({
      template: plan.template,
      role: plan.role,
      values: plan.values,
      outputs: plan.outputs,
      spent: plan.inputs.filter((input) => input.kind !== 'application').map((input) => input.coin.utxo.output),
      about,
      ...(request.page === undefined ? {} : { page: request.page }),
    });
    const kept = this.state.positionRecords ?? [];
    const continues = (entry: PositionRecordEntry): boolean => about.some((token) => sameNft(token, entry.token));
    return due.filter((entry) => !kept.some((known) => (continues(entry) ? samePosition(known, entry) : sameRecord(known, entry))));
  }

  /**
   * Store the records of what an action leaves before anything is signed (section 10.5). Each has to be
   * confirmed by a backup store; the device's own copy does not count.
   * @throws NotStoredError when no store confirms one; nothing has been signed then
   */
  private async storeRecords(records: PositionRecordEntry[]): Promise<void> {
    if (records.length === 0) return;
    const { archive } = this.options;
    if (archive === undefined) throw new NotStoredError('This wallet has no backup store. What an action leaves is recorded there before the action is signed, so that a new device can find it.');
    for (const entry of records) {
      const result = await archive.write(entry);
      if (!safelyStored(result)) {
        throw new NotStoredError(
          `No backup store confirmed the record of what the action leaves: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ') || 'none is configured'}. Nothing was signed. Try again when a store can be reached.`,
        );
      }
      this.change({ positionRecords: [...(this.state.positionRecords ?? []), entry] });
    }
  }

  /**
   * Make sure the template is on a backup store before something comes to depend on it (section 10.5).
   * @throws NotStoredError when no store confirms; the device's own record of the template does not count
   */
  private async ensureStored(kept: KeptTemplate): Promise<KeptTemplate> {
    if (kept.stored) return kept;
    const { archive } = this.options;
    if (archive === undefined) throw new NotStoredError('This wallet has no backup store. A template is stored there before its first action, so that a new device can operate what was made with it.');
    const result = await archive.write(templateEntry(kept.identifier, kept.text, kept.declaration?.text, (kept.references ?? []).map((reference) => reference.text), kept.renewal ?? 0));
    if (!safelyStored(result)) {
      throw new NotStoredError(`No backup store confirmed the template: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ') || 'none is configured'}. Nothing was signed. Try again when a store can be reached.`);
    }
    return this.updateTemplate(kept.identifier, { stored: true });
  }

  /**
   * Store a trusted template in the backup now, where a store can be reached, and not only before its first
   * action: a token that came from elsewhere may already depend on it.
   * @returns whether the backup holds it
   */
  async storeNow(identifier: string): Promise<boolean> {
    const kept = this.state.templates.find((template) => template.identifier === identifier);
    if (kept === undefined) return false;
    try {
      return (await this.ensureStored(kept)).stored;
    } catch {
      return false;
    }
  }

  /**
   * Stop trusting a template, on the user's word. Tokens made with it stay in the wallet and move in a sweep
   * or a recovery like any other coin; what they control is no longer shown or operated, and no application
   * is told about them, until the template is trusted again.
   *
   * The backup keeps the template, as a suggestion, and is told of the withdrawal, so that reading it does
   * not trust the template again. Where no store confirms that now, it is written the next time the backup is read.
   *
   * @returns whether the backup knows: `true` also when it never held the template
   */
  async forget(identifier: string): Promise<{ name: string; backupTold: boolean }> {
    const kept = this.state.templates.find((template) => template.identifier === identifier);
    if (kept === undefined) return refuse('This wallet does not trust that template.');
    const others = (this.state.suggested ?? []).filter((suggested) => !(suggested.identifier === kept.identifier && suggested.contentHash === kept.contentHash));
    const templates = this.state.templates.filter((template) => template !== kept);
    if (!kept.stored) {
      // The backup never held this trust: nothing depends on it there. A record of an earlier trust keeps its withdrawal.
      this.change({ templates, suggested: this.state.suggested ?? [] });
      return { name: kept.name, backupTold: true };
    }
    const suggestion: SuggestedTemplate = {
      identifier: kept.identifier,
      contentHash: kept.contentHash,
      ...(kept.declaration === undefined ? {} : { declaration: kept.declaration.contentHash }),
      name: kept.name,
      texts: { template: kept.text, ...(kept.declaration === undefined ? {} : { declaration: kept.declaration.text }), ...(kept.references === undefined ? {} : { references: kept.references.map((reference) => reference.text) }) },
      withdrawn: { renewal: kept.renewal ?? 0, stored: false },
    };
    this.change({ templates, suggested: [...others, suggestion] });
    return { name: kept.name, backupTold: (await this.tellWithdrawals()) === 0 };
  }

  /** Write the withdrawals the backup does not have yet. @returns how many it still lacks */
  private async tellWithdrawals(): Promise<number> {
    const { archive } = this.options;
    const waiting = (): SuggestedTemplate[] => (this.state.suggested ?? []).filter((suggested) => suggested.withdrawn?.stored === false);
    if (archive === undefined) return waiting().length;
    for (const suggestion of waiting()) {
      const { renewal } = suggestion.withdrawn as { renewal: number };
      const confirmed = await archive.write({ kind: 'template-withdrawal', identifier: suggestion.identifier, contentHash: suggestion.contentHash, renewal }).then(safelyStored, () => false);
      if (!confirmed) continue;
      this.change({
        suggested: (this.state.suggested ?? []).map((suggested) =>
          suggested.identifier === suggestion.identifier && suggested.contentHash === suggestion.contentHash && suggested.withdrawn?.stored === false ? { ...suggested, withdrawn: { renewal, stored: true } } : suggested,
        ),
      });
    }
    return waiting().length;
  }

  /** No longer let an application see the tokens of a template. The template stays trusted. */
  disallow(templateIdentifier: string, application: string): void {
    const kept = this.state.templates.find((template) => template.identifier === templateIdentifier);
    if (kept !== undefined) this.updateTemplate(kept.identifier, { applications: kept.applications.filter((known) => known !== application) });
  }

  // ------------------------------------------------------------------ working an action out

  /**
   * Work an action out: the transaction, its coins and its exact fee, before the user is asked. A template that
   * comes with a recovery declaration of the second design is read by its declaration; one that comes with
   * nothing beside it, from the template, the request and the wallet's records alone (section 13.3).
   */
  private async plan(request: ApplicationAction, definingCoin?: AccountCoin): Promise<Plan> {
    const { template, declaration } = this.templateOf(request);
    const frame = declaration === undefined ? await this.frameAlone(request, template) : await this.frameDeclared(request, template, declaration.declaration);
    return this.complete(frame, request, definingCoin);
  }

  /** The first half of working an action out, for a template that comes with a recovery declaration (the second design). */
  private async frameDeclared(request: ApplicationAction, template: ReadTemplate, declared: RecoveryDeclaration): Promise<Frame> {
    const { definition } = template;
    const action = definition.actions?.[request.action];
    if (action === undefined) return refuse(`The template "${definition.name ?? ''}" has no action "${request.action}".`);
    if (action.roles?.[request.role] === undefined) return refuse(`The action "${action.name ?? request.action}" has no role "${request.role}".`);
    const shape = definition.transactions?.[action.transaction ?? ''] as { inputs?: { input: string; inputIndex?: number }[]; outputs?: { output: string; outputIndex?: number }[] } | undefined;
    if (shape === undefined) return refuse(`The action "${action.name ?? request.action}" has no transaction.`);
    const entry = declared.actions[request.action] ?? {};

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
    const reserved = this.wallet.reserve(kinds);
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
    return {
      template,
      role: request.role,
      action: request.action,
      inputOrder: (shape.inputs ?? []).map(({ input }) => input),
      values,
      kinds,
      reserved,
      leftOver,
      walletScripts,
      ...(creates === undefined ? {} : { creates }),
      applicationCoins,
      follow,
      following,
      ...(token === undefined ? {} : { token }),
      spends: token !== undefined && entry.spends !== undefined,
      ...(position === undefined ? {} : { position }),
      declared: { declaration: declared, entry, fromToken },
    };
  }

  /**
   * The second half of working an action out, the same for every template: the coin that defines a new token
   * category, the template's outputs, the wallet's tokens and coins, the exact fee, the places in the
   * transaction, the checks of what the wallet's tokens come to, and the application's contracts run against the
   * transaction as worked out.
   */
  private async complete(frame: Frame, request: ApplicationAction, definingCoin?: AccountCoin): Promise<Plan> {
    const { template, values, kinds, leftOver, walletScripts, creates, applicationCoins, follow, following, token, position } = frame;
    const { definition } = template;
    const declared = frame.declared?.declaration;
    const entry = frame.declared?.entry ?? {};
    const fromToken = frame.declared?.fromToken ?? [];
    let { reserved } = frame;

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
    // The token the action spends: at the template's input for it, where the template gives it one (section 13.3).
    const spentToken: (PlannedInput & { index?: number }) | undefined =
      token !== undefined && frame.spends
        ? { coin: token.coin, bytes: INPUT_BYTES.byKey, kind: 'token', ...(frame.tokenInput === undefined ? {} : { inputIdentifier: frame.tokenInput.input, ...(frame.tokenInput.index === undefined ? {} : { index: frame.tokenInput.index }) }) }
        : undefined;
    const tokenInput: PlannedInput[] = spentToken === undefined ? [] : [spentToken];

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
    // A token the template gives an input of its own is one of the template's items: at its index, or in the
    // template's order among the items without one.
    const templateInputs: (PlannedInput & { index?: number })[] = [...applicationInputs];
    const spentAsItem = spentToken !== undefined && frame.tokenInput !== undefined;
    if (spentAsItem) {
      const order = (input: string | undefined): number => frame.inputOrder.indexOf(input ?? '');
      const before = applicationInputs.filter((input) => order(input.inputIdentifier) < order(frame.tokenInput?.input)).length;
      templateInputs.splice(before, 0, spentToken);
    }
    const inputs = place<PlannedInput>(templateInputs, definingInput[0], [...(spentAsItem ? [] : tokenInput), ...tokenInputs, ...chosen], 'input');
    const planned = place<PlannedOutput>(templateOutputs, undefined, [...changeOutputs, ...leftOverOutput], 'output');
    for (const input of inputs) delete (input as { index?: number }).index;
    for (const output of planned) delete (output as { index?: number }).index;

    // Without a declaration: the coin at the template's input for the token is the token (the engine does not
    // look), and what becomes of the wallet's tokens is shown, and asks for the user's tick (section 13.3).
    let tokensLeaving: TokenLeaving[] | undefined;
    if (declared === undefined) {
      if (spentAsItem && token !== undefined) this.tokenInputHolds(definition, frame.tokenInput?.input as string, token, values);
      tokensLeaving = leavingTokens(definition, planned, spentToken === undefined ? undefined : token, creates === undefined ? undefined : String(values[creates]));
    }

    // A token that carries authority is a bearer instrument: the one the action spends has to come back to the wallet.
    if (declared !== undefined && token !== undefined && entry.spends !== undefined) {
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
      ...(tokensLeaving === undefined || tokensLeaving.length === 0 ? {} : { tokensLeaving }),
      ...(frame.record === undefined ? {} : { record: frame.record }),
    };
  }

  /**
   * The wallet's own check that the coin it puts at the template's input for the token is that token: the engine
   * does not look at what the input says about its token (section 13.3). The category has to be worked out and
   * be the coin's; the commitment and the capability, where the template gives them and they can be worked out.
   */
  private tokenInputHolds(definition: ReadTemplate['definition'], input: string, token: TokenCoin, values: TemplateValues): void {
    const described = (definition.inputs?.[input] as { name?: string; token?: { category?: unknown; nft?: { capability?: unknown; commitment?: unknown } | null } } | undefined) ?? {};
    const held = token.coin.utxo.output.token;
    const name = described.name ?? input;
    if (held?.nft === undefined) return refuse(`The coin for "${name}" carries no NFT.`);
    const fields: [string, unknown, string, boolean][] = [
      ['category', described.token?.category, hex(held.category), true],
      ['commitment', described.token?.nft?.commitment, hex(held.nft.commitment), false],
      ['capability', described.token?.nft?.capability, held.nft.capability, false],
    ];
    for (const [field, expression, own, needed] of fields) {
      if (expression === undefined || expression === null) continue;
      let worked: string | undefined;
      try {
        worked = templateExpression(definition, expression, values) ?? String(expression);
      } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        if (needed) return refuse(`The token for "${name}" cannot be worked out: ${error.message}`);
        continue;
      }
      if (worked !== own) return refuse(`The template's input "${name}" names a token with another ${field} than the token of the wallet's that the action spends. Nothing was signed.`);
    }
  }

  /**
   * The first half of working an action out for a template that comes with nothing beside it (section 13.3).
   *
   * - **The token.** The request names the position by its token's category and says whether the action spends
   *   it. Where the template gives the token an input of its own, an action whose transaction has it spends it.
   * - **The record.** Of the records of that token and template, the one at a script the action spends, continues
   *   or pays into, as the wallet lists it from the chain: open before closed before not confirmed.
   * - **Each value the role provides,** from the first that applies: (1) the record, for the values of the
   *   position's own script; (2) the wallet itself: a token category the action creates, a locking script the
   *   request does not supply (of the kind the request names, a plain receipt where it names none), and the
   *   category of the template's input for the token from the token itself; (3) the request; (4) the record's
   *   other values, in an action that spends the position; (5) the user, for a value a person can type, when the
   *   wallet acts by itself. A variable nothing fills stops the action, named.
   * - **The application's coins:** each that the request names by outpoint, read from the chain and matched to a
   *   script of the template by its bytecode; and the position's coins at the record's script, for the input whose
   *   unlocking that script names. The wallet looks for no other coin of the application's.
   */
  private async frameAlone(request: ApplicationAction, template: ReadTemplate): Promise<Frame> {
    const { definition } = template;
    const shape = actionShape(definition, request.action, request.role);
    if (typeof shape === 'string') return refuse(shape);
    const nameOf = (variable: string): string => `"${definition.variables?.[variable]?.name ?? variable}"`;
    const inputName = (input: string): string => `"${definition.inputs?.[input]?.name ?? input}"`;
    const byWallet = request.fromWallet !== undefined;

    for (const [variable, kind] of Object.entries(request.bindings ?? {})) {
      if (!(BINDING_KINDS as readonly string[]).includes(kind)) return refuse(`The request asks for an output of kind "${kind}", which this wallet does not offer.`);
      if (variableType(definition, variable) !== 'locking_script' || !shape.required.includes(variable)) return refuse(`The request asks for an address of the wallet's in ${nameOf(variable)}, which is not an address the role provides in this action.`);
    }

    // The token the action is about, and whether it is spent.
    const categories = request.about === undefined ? (request.tokens ?? []) : [request.about.category];
    if (categories.length > 1) return refuse('The action is about one token of the wallet; the request names more than one.');
    const [category] = categories;
    if (category === undefined && shape.tokenInput !== undefined) return refuse(`The action spends a token of the wallet's as ${inputName(shape.tokenInput.input)}; the request has to name it.`);
    const spends = category !== undefined && (shape.tokenInput !== undefined || request.about?.spent === true);
    let token: TokenCoin | undefined;
    if (category !== undefined) {
      const held = (await this.wallet.tokenCoins()).filter(({ coin }) => coin.utxo.output.token?.nft !== undefined && hex(coin.utxo.output.token.category) === category);
      [token] = held;
      if (token === undefined) return refuse('This wallet holds no such token.');
      if (held.length > 1) return refuse('This wallet holds more than one coin with that token; it does not choose between them.');
      if (spends && token.place === 'earlier') return refuse('The token is at an address of an earlier seed, where that seed could still spend it. It is swept first.');
      if (spends && token.place === 'vault') return refuse('The token is at a vault address. It is moved to an ordinary address of the wallet first.');
    }

    // The position's record: one at a script the action spends, continues or pays into.
    const touches = (lockingScript: string): boolean => spendingInputs(definition, shape, lockingScript).length > 0 || paysTo(definition, shape, lockingScript);
    let record: PositionRecordEntry | undefined;
    if (category !== undefined) {
      const rank: Record<RecordedStatus, number> = { open: 0, closed: 1, unconfirmed: 2, held: 3 };
      const listed = (await this.recordedPositions({ template: template.identifier, categories: new Set([category]), trusting: template }))
        .filter(({ record: entry }) => entry.lockingScriptIdentifier !== undefined && entry.roleIdentifier === request.role && touches(entry.lockingScriptIdentifier))
        .sort((a, b) => rank[a.status] - rank[b.status]);
      record = listed[0]?.record;
    }
    const page =
      record?.applicationPage ??
      [...this.positionRecords, ...this.suggestedRecords].find((entry) => entry.token?.category === category && category !== undefined && entry.templateIdentifier === template.identifier && entry.applicationPage !== undefined)?.applicationPage;
    const positionScript = record?.lockingScriptIdentifier;
    const positionInputs = positionScript === undefined ? [] : spendingInputs(definition, shape, positionScript);
    const spendsPosition = positionInputs.length > 0;

    // The values, each from the first source that has it.
    const raw: Record<string, string | number> = {};
    const bound: [string, BindingKind][] = [];
    const missing: string[] = [];
    const supplied = (variable: string): string | number | undefined => request.variables[variable];
    // A category the request gives as that of the wallet's own token is not made now: a category is made only once.
    const creating = shape.creating.filter((variable) => !(category !== undefined && String(supplied(variable) ?? '') === category));
    let creates: string | undefined;
    for (const variable of shape.required) {
      const type = variableType(definition, variable) ?? '';
      // 1. The record, for the values of the position's own script.
      const scriptValue = record?.variables?.[variable];
      if (scriptValue !== undefined) {
        raw[variable] = scriptValue;
        continue;
      }
      // 2. The wallet itself.
      if (creating.includes(variable)) {
        if (creates !== undefined) return refuse('The action makes more than one new token category; the wallet supplies the coin for one.');
        creates = variable;
        continue;
      }
      if (type === 'locking_script' && (request.bindings?.[variable] !== undefined || supplied(variable) === undefined)) {
        bound.push([variable, (request.bindings?.[variable] ?? 'receive') as BindingKind]);
        continue;
      }
      if (variable === shape.tokenInput?.variable && token !== undefined && supplied(variable) === undefined) {
        raw[variable] = hex(token.coin.utxo.output.token?.category ?? new Uint8Array());
        continue;
      }
      // 3. The request.
      const requested = supplied(variable);
      if (requested !== undefined) {
        raw[variable] = requested;
        continue;
      }
      // 4. The record's other values, in an action that spends the position. Never an address.
      const otherValue = spendsPosition && type !== 'locking_script' ? record?.values[variable] : undefined;
      if (otherValue !== undefined) {
        raw[variable] = otherValue;
        continue;
      }
      // 5. The user, for a value a person can type.
      const typed = TYPEABLE.has(type) ? request.fromWallet?.typed[variable] : undefined;
      if (typed !== undefined) {
        raw[variable] = typed;
        continue;
      }
      missing.push(variable);
    }
    if (request.creates !== undefined && request.creates !== creates) {
      return refuse(`The request says that the action makes a new token category in ${nameOf(request.creates)}; the template's transaction says otherwise.`);
    }
    if (missing.length > 0) {
      const names = missing.map(nameOf).join(', ');
      if (!byWallet) return refuse(`The action needs a value for ${names}, and nothing fills it: not the position's record, not the wallet, not the request. Nothing was signed.`);
      const untypeable = missing.filter((variable) => !TYPEABLE.has(variableType(definition, variable) ?? ''));
      if (untypeable.length > 0) throw new NeedsApplicationError(`It needs ${untypeable.map(nameOf).join(', ')}, which only the application gives.`, page);
      return refuse(`Give a value for ${names}.`);
    }

    // The wallet's own outputs: a fresh address for each, of the kind named; a `return` repeats the token's script.
    for (const [variable, kind] of bound) {
      if (kind === 'return' && (!spends || token === undefined)) return refuse(`The output "${variable}" is to return to the script of an input that is not the wallet's.`);
    }
    const addressed = bound.filter(([, kind]) => kind !== 'return');
    const kinds = [...addressed.map(([, kind]) => (kind === 'lasting' ? ADDRESS_KIND.vault : ADDRESS_KIND.change)), ADDRESS_KIND.change];
    const reserved = this.wallet.reserve(kinds);
    const leftOver = reserved.at(-1) as ReservedAddress;
    const walletScripts = new Map<string, WalletOutputKind>();
    walletScripts.set(hex(leftOver.address.lockingBytecode), 'left over');
    let values: TemplateValues;
    try {
      values = typedValues(definition, raw);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }
    addressed.forEach(([variable, kind], index) => {
      const { address } = reserved[index] as ReservedAddress;
      values[variable] = hex(address.lockingBytecode);
      walletScripts.set(hex(address.lockingBytecode), kind);
    });
    for (const [variable, kind] of bound) {
      if (kind !== 'return' || token === undefined) continue;
      values[variable] = hex(token.coin.utxo.output.lockingBytecode);
      walletScripts.set(hex(token.coin.utxo.output.lockingBytecode), 'return');
    }

    // The application's coins: those the request names, and the position's at the record's script.
    const follow = new Map<string, FollowedScript>();
    const following = new Map<string, string>();
    const applicationCoins: Frame['applicationCoins'] = [];
    const followed = (lockingScript: string, variables: TemplateValues, lockingBytecode: Uint8Array): void => {
      const own = Object.fromEntries(scriptVariables(definition, lockingScript).flatMap((name) => (variables[name] === undefined ? [] : [[name, variables[name] as string | number | bigint]])));
      const key = `${lockingScript}:${JSON.stringify(own, (_key, value: unknown) => (typeof value === 'bigint' ? String(value) : value))}`;
      follow.set(key, { template: template.identifier, lockingScript, role: request.role, variables: own });
      following.set(hex(lockingBytecode), key);
    };
    const named = request.inputs ?? {};
    for (const input of Object.keys(named)) {
      if (!shape.inputs.some((item) => item.input === input)) return refuse(`The request names a coin for ${inputName(input)}, which the action does not spend.`);
      if (input === shape.tokenInput?.input) return refuse(`The request names a coin for ${inputName(input)}, where the wallet puts its own token.`);
    }
    try {
      for (const { input, inputIndex } of applicationInputs(definition, shape)) {
        if ((definition.inputs?.[input] as { unlockingScript?: string } | undefined)?.unlockingScript === undefined) {
          return refuse(`The template does not say how its input ${inputName(input)} is unlocked, and it is not the wallet's token.`);
        }
        const at = inputIndex === undefined ? {} : { index: inputIndex };
        const outpoint = named[input];
        if (outpoint !== undefined) {
          const { utxo, lockingScript } = await this.namedCoin(definition, input, outpoint, values);
          if (applicationCoins.some((coin) => outpointOf(coin.utxo) === outpointOf(utxo))) return refuse(`The coin for ${inputName(input)} is already spent as another input of the action.`);
          applicationCoins.push({ input, ...at, utxo, lockingScript });
          followed(lockingScript, values, utxo.output.lockingBytecode);
          continue;
        }
        if (positionScript !== undefined && positionInputs.includes(input)) {
          const scriptValues = typedValues(definition, record?.variables ?? {});
          const lockingBytecode = templateLockingBytecode(definition, positionScript, scriptValues);
          const coins = (await coinsAt(this.wallet.chain, lockingBytecode)).filter((utxo) => !applicationCoins.some((coin) => outpointOf(coin.utxo) === outpointOf(utxo)));
          if (coins.length === 0) return refuse('There is nothing to spend: the position holds no coin.');
          if (inputIndex !== undefined && coins.length > 1) return refuse('The template gives the position one place in the transaction, and it is made of several coins.');
          for (const utxo of coins) applicationCoins.push({ input, ...at, utxo, lockingScript: positionScript });
          followed(positionScript, scriptValues, lockingBytecode);
          continue;
        }
        if (byWallet) throw new NeedsApplicationError(`It spends a coin of the application's, ${inputName(input)}, which only the application can name.`, page);
        return refuse(`The action spends a coin of the application's as ${inputName(input)}. The request has to name it by its outpoint; this wallet does not look for such coins itself.`);
      }
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }

    return {
      template,
      role: request.role,
      action: request.action,
      inputOrder: shape.inputs.map(({ input }) => input),
      values,
      kinds,
      reserved,
      leftOver,
      walletScripts,
      ...(creates === undefined ? {} : { creates }),
      applicationCoins,
      follow,
      following,
      ...(token === undefined ? {} : { token }),
      spends,
      ...(shape.tokenInput === undefined || !spends ? {} : { tokenInput: { input: shape.tokenInput.input, ...(shape.tokenInput.index === undefined ? {} : { index: shape.tokenInput.index }) } }),
      ...(record === undefined ? {} : { record }),
    };
  }

  /**
   * A coin of the application's that a request names by outpoint, for a template that comes with no declaration.
   * The wallet reads it from the chain and does not take the request's word for what it holds. Which of the
   * template's scripts it sits at, the wallet finds by comparing its locking bytecode with each script the
   * template gives, made with the action's values; the script whose unlocking is the input's is tried first. A
   * coin at no script of the template is refused, and so is one that is spent.
   */
  private async namedCoin(definition: ReadTemplate['definition'], input: string, outpoint: string, values: TemplateValues): Promise<{ utxo: Utxo; lockingScript: string }> {
    const name = definition.inputs?.[input]?.name ?? input;
    const [transactionId = '', index = ''] = outpoint.split(':');
    if (!/^[0-9a-f]{64}$/.test(transactionId) || !/^\d{1,5}$/.test(index)) return refuse(`The request names the coin for "${name}" in a form this wallet does not read.`);
    const text = await this.wallet.chain.getTransaction(transactionId);
    const transaction = text === undefined ? undefined : decodeTransactionBch(hexToBin(text));
    const output = transaction === undefined || typeof transaction === 'string' ? undefined : transaction.outputs[Number(index)];
    if (output === undefined) return refuse(`The coin the request names for "${name}" is not on chain.`);
    const unlocking = (definition.inputs?.[input] as { unlockingScript?: string } | undefined)?.unlockingScript;
    const scripts = Object.entries(definition.lockingScripts ?? {})
      .map(([identifier, script]) => ({ identifier, first: (script as { unlockingBytecode?: string }).unlockingBytecode === unlocking }))
      .sort((a, b) => Number(b.first) - Number(a.first))
      .map(({ identifier }) => identifier);
    const lockingScript = scripts.find((candidate) => {
      try {
        return hex(templateLockingBytecode(definition, candidate, values)) === hex(output.lockingBytecode);
      } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        return false;
      }
    });
    if (lockingScript === undefined) return refuse(`The coin the request names for "${name}" is at no script of the template "${definition.name ?? ''}", made with the values of this action. It is refused.`);
    const unspent = (await this.wallet.chain.listUnspent(output.lockingBytecode)).some((listed) => listed.transactionId === transactionId && listed.index === Number(index));
    if (!unspent) return refuse(`The coin the request names for "${name}" is spent.`);
    return { utxo: { transactionHash: hexToBin(transactionId), index: Number(index), output }, lockingScript };
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
    const { template, declaration, kept, replaces } = this.templateOf(request);
    const summary = this.summary(template, declaration, kept, replaces);
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
    const records = await this.recordsOf(plan, request);
    const notConfirmed = await this.onlyTakingOut(plan, request);
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
      ...(records.length === 0 ? {} : { recordsPosition: true }),
      ...(notConfirmed === undefined ? {} : { notConfirmed }),
      ...(plan.tokensLeaving === undefined ? {} : { tokensLeaving: plan.tokensLeaving }),
    };
  }

  /**
   * An action that does not deliver a token to the wallet unchanged is carried out only with the user's tick
   * (section 13.3; decisions 30 and 32).
   * @throws TickNeededError without it
   */
  private requireTick(plan: Plan, consent: ActionConsent): void {
    const leaving = plan.tokensLeaving ?? [];
    if (leaving.length === 0 || consent.tokensLeave === true) return;
    const what = leaving.map(({ token, how, made, to }) => {
      const which = `${made === true ? 'a token made now from the wallet\'s coin' : 'the wallet\'s token'} of category ${token.category}`;
      return how === 'leaves' ? `${which} goes to ${to === undefined ? 'someone else' : `"${to}"`}, out of the wallet` : how === 'changes' ? `${which} comes back changed` : `${which} ends: no output carries it on`;
    });
    throw new TickNeededError(`In this action ${what.join('; ')}. It is carried out only when you tick that this is what you want. Nothing was signed.`, leaving);
  }

  /**
   * The names the templates the user trusts give the tokens they deal in (section 13.3). Nothing else names a
   * token: no registry, no application, no request.
   */
  names(): TokenNames {
    const claims: NameClaim[] = [];
    for (const kept of this.state.templates) {
      if (kept.declaration === undefined) continue;
      try {
        const { declaration } = readDeclaration(kept.declaration.text);
        for (const description of Object.values(declaration.tokens ?? {})) claims.push({ description, template: { identifier: kept.identifier, name: kept.name } });
      } catch {
        // A declaration this wallet once took in and cannot read now names nothing.
      }
    }
    return new TokenNames(claims);
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
   * the template, and stores it in the backup before anything is signed; so too the record of each position
   * the action leaves (section 10.5).
   *
   * @param onStage - `recorded`: the backup holds the template. `sent`: the transaction is on the network.
   * @param consent - what the user ticked beside the action: that tokens leave the wallet, come back changed or end (`ActionPreview.tokensLeaving`)
   * @throws NotStoredError when no backup store confirms a new template or the record of a position; ActionRefusedError,
   *   TickNeededError where the user's tick is needed and not given, NeedsApplicationError; InsufficientFundsError
   */
  async carryOut(request: ApplicationAction, onStage: (stage: 'recorded' | 'sent') => void = () => undefined, consent: ActionConsent = {}): Promise<ActionOutcome> {
    this.wallet.requireUsable();
    // Everything that can refuse the action does so before the template is taken in.
    const first = await this.plan(request);
    this.requireTick(first, consent);
    await this.onlyTakingOut(first, request);
    const kept = await this.ensureStored(await this.trust(request.template, request.presented, request.application));
    onStage('recorded');
    const identifier = await this.wallet.backend.importTemplate(kept.text);
    if (identifier !== kept.identifier) throw new Error('The key holder gives the template another identifier than the one it was trusted under.');

    let plan = await this.plan(request);
    if (plan.payItself !== undefined) {
      const { coin } = await this.wallet.payItself(plan.payItself);
      plan = await this.plan(request, coin);
    }
    this.requireTick(plan, consent);
    await this.wallet.hold(plan.reserved);
    let prepared: PreparedTransaction;
    try {
      // What the action leaves is recorded, from the transaction worked out, before anything is signed. What the
      // key holder builds is then checked to be that very transaction.
      await this.storeRecords(await this.recordsOf(plan, request));
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
    const { templates, tokenNotes, positions = [] } = await archive.read();
    const same = (a: Pick<TemplateNames, 'identifier' | 'contentHash'>, b: Pick<TemplateNames, 'identifier' | 'contentHash'>): boolean => a.identifier === b.identifier && a.contentHash === b.contentHash;
    let suggested = [...(this.state.suggested ?? [])];
    for (const { entry, standing, withdrawn } of templates) {
      const names: TemplateNames = { identifier: entry.identifier, contentHash: entry.contentHash, ...(entry.declaration === undefined ? {} : { declaration: entry.declaration.contentHash }) };
      const texts: PresentedTexts = { template: entry.text, ...(entry.declaration === undefined ? {} : { declaration: entry.declaration.text }), ...(entry.references === undefined ? {} : { references: entry.references.map((reference) => reference.text) }) };
      if (this.keptTemplate(names) !== undefined) continue;
      try {
        const renewal = entry.renewal ?? 0;
        const local = suggested.find((known) => same(known, names))?.withdrawn;
        if (standing === 'current owner' && withdrawn !== undefined) {
          // This seed stopped trusting it: a suggestion, which remembers the withdrawal's number.
          const known = suggested.find((candidate) => same(candidate, names));
          if (known?.withdrawn === undefined || known.withdrawn.renewal < withdrawn || !known.withdrawn.stored) {
            suggested = [...suggested.filter((candidate) => !same(candidate, names)), { ...names, name: readPresented(names, texts).template.definition.name ?? 'Unnamed template', texts, withdrawn: { renewal: Math.max(withdrawn, known?.withdrawn?.renewal ?? 0), stored: true } }];
          }
        } else if (standing === 'current owner' && local !== undefined && local.renewal >= renewal) {
          // Withdrawn on this device, and the backup has not been told yet.
        } else if (standing === 'current owner') {
          // A record the withdrawals do not reach: trusted, as it was when it was stored.
          suggested = suggested.filter((candidate) => !(same(candidate, names) && candidate.withdrawn !== undefined));
          this.change({ suggested });
          await this.trust(names, texts);
          this.updateTemplate(names.identifier, { stored: true, ...(renewal === 0 ? {} : { renewal }) });
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
    await this.tellWithdrawals();
    await this.takeRecords(archive, positions);
    return { suggested: this.suggestions.length, notes: notes.length };
  }

  /**
   * Take in the position records the backup holds (section 10.6). This seed's own are kept as its own. Those
   * of an earlier seed are suggestions: each is written again, with the values of the earlier record, as this
   * seed's own only once the chain has borne it out, and a store has confirmed it. A record that does not
   * count yet stays a suggestion, and is checked again the next time the backup is read.
   */
  private async takeRecords(archive: ApplicationArchive, read: { entry: PositionRecordEntry; standing: Standing }[]): Promise<void> {
    const own = [...(this.state.positionRecords ?? [])];
    let suggested = [...(this.state.suggestedRecords ?? [])];
    for (const { entry, standing } of read) {
      if (standing === 'current owner') {
        if (!own.some((known) => sameRecord(known, entry))) own.push(entry);
        suggested = suggested.filter((known) => !sameRecord(known, entry));
      } else if (!own.some((known) => sameRecord(known, entry)) && !suggested.some((known) => sameRecord(known, entry))) {
        suggested.push(entry);
      }
    }
    this.change({ positionRecords: own, suggestedRecords: suggested });
    await this.confirmSuggested(archive);
  }

  /**
   * Check the records of an earlier seed against the chain again (section 10.6), for instance once the user has
   * trusted their template. Each that counts is written again as this seed's own, with the values of the earlier
   * record, once a store has confirmed it; and its script is made known to the key holder with those values.
   */
  async confirmRecords(): Promise<{ confirmed: number; suggested: number; followed: number; notFollowed: string[] }> {
    const { archive } = this.options;
    if (archive === undefined) return { confirmed: 0, suggested: this.suggestedRecords.length, followed: 0, notFollowed: [] };
    return this.confirmSuggested(archive);
  }

  private async confirmSuggested(archive: ApplicationArchive): Promise<{ confirmed: number; suggested: number; followed: number; notFollowed: string[] }> {
    const check = this.options.checkRecord ?? checkPositionRecord;
    let confirmed = 0;
    let followed = 0;
    const notFollowed: string[] = [];
    for (const entry of [...(this.state.suggestedRecords ?? [])]) {
      const trusted = this.state.templates.find((template) => template.identifier === entry.templateIdentifier);
      let counts = false;
      try {
        counts = (await check(entry, this.wallet, trusted === undefined ? undefined : readTemplate(trusted.text))).counts;
      } catch {
        // A check that cannot be made leaves the record a suggestion; it is made again the next time.
      }
      if (!counts) continue;
      const stored = await archive.write(entry).then(safelyStored, () => false);
      if (!stored) continue;
      confirmed += 1;
      this.change({
        positionRecords: [...(this.state.positionRecords ?? []), entry],
        suggestedRecords: (this.state.suggestedRecords ?? []).filter((known) => !sameRecord(known, entry)),
      });
      // A token made with the template has led to its position through a record the chain confirmed (section 14.3).
      // A record that names no script ties a token to the template and leads to no position: it says nothing here.
      if (trusted !== undefined && entry.lockingScriptIdentifier !== undefined && trusted.cameBack !== true) this.updateTemplate(trusted.identifier, { cameBack: true });
      // The new device's key holder knows only what it is given (section 10.6): the script, with the record's values.
      if (trusted === undefined || entry.lockingScriptIdentifier === undefined || entry.roleIdentifier === undefined) continue;
      try {
        const identifier = await this.wallet.backend.importTemplate(trusted.text);
        await this.wallet.backend.followScript({ template: identifier, lockingScript: entry.lockingScriptIdentifier, role: entry.roleIdentifier, variables: typedValues(readTemplate(trusted.text).definition, entry.variables ?? {}) });
        followed += 1;
      } catch (error) {
        // An action on the position makes its script known again before it is built.
        notFollowed.push(`${entry.lockingScriptIdentifier}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { confirmed, suggested: this.suggestedRecords.length, followed, notFollowed };
  }

  /** The script a record names, made from its template, where the device has the template's text. */
  private recordScript(entry: PositionRecordEntry): string | undefined {
    if (entry.lockingScriptIdentifier === undefined) return undefined;
    const text = this.state.templates.find((template) => template.identifier === entry.templateIdentifier)?.text ?? (this.state.suggested ?? []).find((template) => template.identifier === entry.templateIdentifier)?.texts.template;
    if (text === undefined) return undefined;
    try {
      const { definition } = readTemplate(text);
      return hex(templateLockingBytecode(definition, entry.lockingScriptIdentifier, typedValues(definition, entry.variables ?? {})));
    } catch {
      return undefined;
    }
  }

  /**
   * The positions the wallet lists from its records (sections 10.4 and 14.2): for each NFT it holds, the records
   * that name its category, each checked against the chain. Of the records that count for one NFT and name a
   * script, the one whose script holds coins is the current one and the others are not listed; none holding
   * coins means closed; more than one holding coins means each is shown as not confirmed. A record that names
   * no script and counts gives the token under its template's name, with no word on whether the position is
   * open. A record that does not count is shown as not confirmed. A token without a record is not a position:
   * it is listed by `tokens` alone. A record whose NFT the wallet does not hold is no position.
   *
   * @param options.template - only records of this template
   * @param options.categories - only NFTs of these categories
   * @param options.trusting - a template the user is asked to trust together with an action: its records are
   *   checked as if it were trusted, since nothing is done unless the user approves
   * @throws when the chain cannot be read: the list is then not to be taken as empty
   */
  async recordedPositions(options: { template?: string; categories?: Set<string>; trusting?: ReadTemplate } = {}): Promise<RecordedPosition[]> {
    const check = this.options.checkRecord ?? checkPositionRecord;
    const records: { entry: PositionRecordEntry; standing: RecordedPosition['standing'] }[] = [];
    for (const [list, standing] of [
      [this.positionRecords, 'own'],
      [this.suggestedRecords, 'suggested'],
    ] as const) {
      for (const entry of list) {
        if (entry.token === undefined || (options.template !== undefined && entry.templateIdentifier !== options.template)) continue;
        if (options.categories !== undefined && !options.categories.has(entry.token.category)) continue;
        if (!records.some((known) => sameRecord(known.entry, entry))) records.push({ entry, standing });
      }
    }
    if (records.length === 0) return [];
    const coins = (await this.wallet.tokenCoins()).filter(({ coin }) => coin.utxo.output.token?.nft !== undefined);
    const nameOf = (identifier: string): string | undefined => this.state.templates.find((template) => template.identifier === identifier)?.name ?? (this.state.suggested ?? []).find((template) => template.identifier === identifier)?.name;
    const read = new Map<string, ReadTemplate>();
    const trusted = (identifier: string): ReadTemplate | undefined => {
      const kept = this.state.templates.find((template) => template.identifier === identifier);
      if (kept === undefined) return options.trusting?.identifier === identifier ? options.trusting : undefined;
      const known = read.get(identifier) ?? readTemplate(kept.text);
      read.set(identifier, known);
      return known;
    };
    const holding = new Map<string, { satoshis: bigint; coins: number }>();
    const holds = async (script: string): Promise<{ satoshis: bigint; coins: number }> => {
      const known = holding.get(script);
      if (known !== undefined) return known;
      const unspent = await this.wallet.chain.listUnspent(hexToBin(script));
      const found = { satoshis: sum(unspent.map((entry) => entry.valueSatoshis)), coins: unspent.length };
      holding.set(script, found);
      return found;
    };
    const listed: RecordedPosition[] = [];
    for (const { coin, place } of coins) {
      const held = tokenOf(coin);
      if (held === undefined) continue;
      const category = hex(held.category);
      const outpoint = outpointOf(coin.utxo);
      const mine = records.filter(({ entry }) => entry.token?.category === category);
      if (mine.length === 0) continue;
      const token: RecordedPosition['token'] = { category, commitment: hex(held.commitment), capability: held.capability, outpoint, satoshis: coin.utxo.output.valueSatoshis, place };
      const checked: { entry: PositionRecordEntry; standing: RecordedPosition['standing']; verdict: PositionRecordVerdict; script?: string }[] = [];
      for (const { entry, standing } of mine) {
        const verdict = await check(entry, this.wallet, trusted(entry.templateIdentifier));
        // A record that counts belongs to the coin the check tied it to.
        if (verdict.counts && verdict.heldAt !== undefined && verdict.heldAt !== outpoint) continue;
        const script = verdict.lockingBytecode === undefined ? this.recordScript(entry) : hex(verdict.lockingBytecode);
        checked.push({ entry, standing, verdict, ...(script === undefined ? {} : { script }) });
      }
      const position = async (item: (typeof checked)[number], status: RecordedStatus, reason?: string): Promise<RecordedPosition> => {
        const lockingScript = item.entry.lockingScriptIdentifier === undefined ? undefined : (trusted(item.entry.templateIdentifier)?.definition.lockingScripts?.[item.entry.lockingScriptIdentifier] as { roles?: Record<string, { actions?: { action: string }[] }> } | undefined);
        const actions = lockingScript?.roles?.[item.entry.roleIdentifier ?? '']?.actions?.map(({ action }) => action);
        const name = nameOf(item.entry.templateIdentifier);
        return {
          token,
          template: { identifier: item.entry.templateIdentifier, ...(name === undefined ? {} : { name }) },
          status,
          ...(reason === undefined ? {} : { reason }),
          record: item.entry,
          standing: item.standing,
          ...(item.script === undefined ? {} : { lockingBytecode: item.script, ...(await holds(item.script)) }),
          ...(actions === undefined ? {} : { actions }),
        };
      };
      // Records that count and name a script, each script once; this seed's own record first.
      const counting = checked.filter(({ verdict, entry }) => verdict.counts && entry.lockingScriptIdentifier !== undefined);
      const scripts = [...new Map(counting.map((item) => [item.script ?? '', item])).values()];
      const filled = [];
      for (const item of scripts) if ((await holds(item.script ?? '')).coins > 0) filled.push(item);
      if (filled.length === 1) listed.push(await position(filled[0] as (typeof checked)[number], 'open'));
      else if (filled.length > 1) {
        for (const item of filled) listed.push(await position(item, 'unconfirmed', `${filled.length} records count for this token and the scripts of more than one hold coins. One of them may be a trap.`));
      } else if (scripts.length > 0) listed.push(await position(scripts.at(-1) as (typeof checked)[number], 'closed'));
      for (const item of checked.filter(({ verdict, entry }) => verdict.counts && entry.lockingScriptIdentifier === undefined)) {
        if (!listed.some((known) => known.token.outpoint === outpoint && known.status === 'held' && known.template.identifier === item.entry.templateIdentifier)) listed.push(await position(item, 'held'));
      }
      const shown = new Set(scripts.map(({ script }) => script));
      for (const item of checked.filter(({ verdict }) => !verdict.counts)) {
        if (item.script !== undefined && shown.has(item.script)) continue;
        if (item.script !== undefined) shown.add(item.script);
        listed.push(await position(item, 'unconfirmed', item.verdict.reason));
      }
    }
    return listed;
  }

  /**
   * Why an action is at a position that is not confirmed (section 10.4), or `undefined` where it is at none:
   * the action is about a token of the wallet's for which no record counts, or it pays or spends at the script
   * of a record that the wallet lists as not confirmed.
   */
  private async notConfirmedAt(plan: Plan, request: ApplicationAction): Promise<string | undefined> {
    const about = new Set([
      ...(request.tokens ?? []),
      ...(request.about === undefined ? [] : [request.about.category]),
      ...(plan.token === undefined ? [] : [hex(plan.token.coin.utxo.output.token?.category ?? new Uint8Array())]),
    ]);
    const touched = new Set([...plan.outputs.filter(({ wallet }) => wallet === undefined).map(({ output }) => hex(output.lockingBytecode)), ...plan.inputs.filter(({ kind }) => kind === 'application').map(({ coin }) => hex(coin.utxo.output.lockingBytecode))]);
    const named = [...this.positionRecords, ...this.suggestedRecords].filter((entry) => entry.token !== undefined && touched.has(this.recordScript(entry) ?? '')).map((entry) => entry.token?.category as string);
    if (about.size === 0 && named.length === 0) return undefined;
    const listed = await this.recordedPositions({ categories: new Set([...about, ...named]), trusting: plan.template });
    const confirmed = (position: RecordedPosition): boolean => position.status !== 'unconfirmed';
    for (const category of about) {
      const ofToken = listed.filter((position) => position.token.category === category);
      if (!ofToken.some(confirmed)) return ofToken[0]?.reason ?? 'No record of this wallet ties the token to a position.';
    }
    for (const script of touched) {
      const at = listed.filter((position) => position.lockingBytecode === script);
      if (at.length > 0 && !at.some(confirmed)) return at[0]?.reason;
    }
    return undefined;
  }

  /**
   * Whether the wallet's own figures show that it gives nothing but the fee: what leaves its coins comes back,
   * less the fee, and every token of the wallet's that the action spends comes back unchanged.
   */
  private givesOnlyFee(plan: Plan): boolean {
    const ours = plan.inputs.filter(({ kind }) => kind !== 'application').map(({ coin }) => coin.utxo.output);
    const back = plan.outputs.filter(({ wallet }) => wallet !== undefined).map(({ output }) => output);
    if (sum(ours.map((output) => output.valueSatoshis)) - sum(back.map((output) => output.valueSatoshis)) > plan.feeSatoshis) return false;
    const fungibleBack = fungible(back);
    if ([...fungible(ours)].some(([category, amount]) => (fungibleBack.get(category) ?? 0n) < amount)) return false;
    return ours.every(({ token }) => token?.nft === undefined || back.some((output) => sameToken({ ...token, amount: 0n }, output.token === undefined ? undefined : { ...output.token, amount: 0n })));
  }

  /**
   * The rule for a position that is not confirmed (section 10.4): an action there is carried out only when the
   * wallet gives nothing but the fee. Money can be taken out, and none is paid in.
   * @returns the reason the position is not confirmed, for an action that may go on
   * @throws ActionRefusedError for any other action there
   */
  private async onlyTakingOut(plan: Plan, request: ApplicationAction): Promise<string | undefined> {
    const reason = await this.notConfirmedAt(plan, request);
    if (reason === undefined || this.givesOnlyFee(plan)) return reason;
    return refuse(`This position is not confirmed: ${reason} The wallet carries out an action there only when it gives nothing but the fee, and this one would pay into it or give tokens away. Nothing was signed.`);
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
      const base = {
        category,
        commitment: hex(token.nft?.commitment ?? new Uint8Array()),
        ...(token.nft === undefined ? {} : { capability: token.nft.capability }),
        amount: token.amount,
        place,
        outpoint: outpointOf(coin.utxo),
        satoshis: coin.utxo.output.valueSatoshis,
      };
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
              : suggested.withdrawn !== undefined
                ? `A note says the template "${suggested.name}" made this token. You stopped trusting that template.`
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
              // An action that spends the position is offered only while there is one.
              actions: entry.actions.flatMap((action) => {
                if (found.status !== 'open' && declaration.declaration.actions[action]?.position !== undefined) return [];
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
    // What the trusted templates call each token: an NFT also by the authority entry it was found to be.
    const names = this.names();
    return held.map((token) => {
      const fungible = token.amount > 0n ? names.fungible(token.category) : undefined;
      const nft =
        token.capability === undefined
          ? undefined
          : names.nft(token.category, token.meaning === 'position' && token.template !== undefined && token.authority !== undefined ? { template: token.template.identifier, entry: token.authority } : undefined);
      return fungible === undefined && nft === undefined ? token : { ...token, names: { ...(fungible === undefined ? {} : { fungible }), ...(nft === undefined ? {} : { nft }) } };
    });
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
   * The positions of one template the wallet lists from its records, for the application that asks (section 14.2,
   * version 2): each token a record ties to the template, with where its position stands. A token without a
   * record is not among them.
   *
   * @param application - the application that asks. It is answered only for a template the user trusted in a session with it.
   * @returns `undefined` when the template is not trusted, or not with this application
   */
  async positionsFromRecords(templateIdentifier: string, application?: string): Promise<RecordedPosition[] | undefined> {
    const kept = this.state.templates.find((template) => template.identifier === templateIdentifier);
    if (kept === undefined || (application !== undefined && !kept.applications.includes(application))) return undefined;
    return this.recordedPositions({ template: templateIdentifier });
  }

  /**
   * The actions the wallet offers from its own list for a position at a script of its own (section 13.3): those
   * the script offers the record's role, for a template that comes with no declaration. Each says what the user
   * is asked to type, or, where the action needs a coin or a value that only the application gives, that it is
   * done through the application, with the page the record names. An action that spends the position is not
   * offered once it is closed.
   */
  offeredActions(position: Pick<RecordedPosition, 'template' | 'record' | 'status'>): TokenAction[] {
    const kept = this.state.templates.find((template) => template.identifier === position.template.identifier);
    const { record } = position;
    const script = record.lockingScriptIdentifier;
    const role = record.roleIdentifier;
    if (kept === undefined || kept.declaration !== undefined || script === undefined || role === undefined) return [];
    const { definition } = readTemplate(kept.text);
    const page = record.applicationPage;
    const described = (variable: string) => ({ variable, name: definition.variables?.[variable]?.name ?? variable, description: definition.variables?.[variable]?.description ?? '', type: String(variableType(definition, variable) ?? 'bytes') });
    return offeredAt(definition, script, role).flatMap((action): TokenAction[] => {
      const shape = actionShape(definition, action, role);
      if (typeof shape === 'string') return [];
      const positionInputs = spendingInputs(definition, shape, script);
      const spendsPosition = positionInputs.length > 0;
      if (spendsPosition && position.status === 'closed') return [];
      const touches = spendsPosition || paysTo(definition, shape, script);
      const asks: NonNullable<TokenAction['asks']> = [];
      const missing: string[] = [];
      for (const variable of shape.required) {
        const type = variableType(definition, variable) ?? '';
        if (touches && record.variables?.[variable] !== undefined) continue;
        if (shape.creating.includes(variable) || type === 'locking_script' || variable === shape.tokenInput?.variable) continue;
        if (spendsPosition && record.values[variable] !== undefined) continue;
        if (TYPEABLE.has(type)) asks.push(described(variable));
        else missing.push(variable);
      }
      const coins = applicationInputs(definition, shape).filter(({ input }) => !positionInputs.includes(input));
      const reasons = [
        ...coins.map(({ input }) => `It spends a coin of the application's, "${definition.inputs?.[input]?.name ?? input}", which only the application can name.`),
        ...(missing.length === 0 ? [] : [`It needs ${missing.map((variable) => `"${described(variable).name}"`).join(', ')}, which only the application gives.`]),
      ];
      const words = definition.actions?.[action];
      return [
        {
          action,
          role,
          name: words?.name ?? action,
          description: words?.description ?? '',
          ...(asks.length === 0 ? {} : { asks }),
          ...(reasons.length === 0 ? {} : { needsApplication: reasons.join(' '), ...(page === undefined ? {} : { page }) }),
        },
      ];
    });
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
   * consulted: everything comes from the token, the template and the chain. The token is one the wallet lists,
   * from `tokens` or from `recordedPositions`.
   */
  actionOn(
    token: { category: string; template?: { identifier: string } | undefined; record?: PositionRecordEntry } | Pick<RecordedPosition, 'token' | 'template' | 'record'>,
    action: string,
    variables: Record<string, string | number> = {},
  ): ApplicationAction {
    const category = 'category' in token ? token.category : token.token.category;
    const kept = this.state.templates.find((template) => template.identifier === token.template?.identifier);
    if (kept === undefined) return refuse('The template of this token is not trusted on this device.');
    const { definition } = this.read(kept).template;
    const described = definition.actions?.[action];
    const recordRole = token.record?.roleIdentifier;
    const [role] = recordRole !== undefined && described?.roles?.[recordRole] !== undefined ? [recordRole] : Object.keys(described?.roles ?? {});
    if (role === undefined) return refuse(`The template "${kept.name}" has no action "${action}".`);
    if (kept.declaration === undefined) {
      // From the template and the record alone (section 13.3): the token is the record's, and the action spends it
      // where the template gives it an input of its own or the action spends the position; what the user typed
      // comes after the record and the wallet's own values.
      const shape = actionShape(definition, action, role);
      const script = token.record?.lockingScriptIdentifier;
      const spent = typeof shape !== 'string' && (shape.tokenInput !== undefined || (script !== undefined && spendingInputs(definition, shape, script).length > 0));
      return {
        template: { identifier: kept.identifier, contentHash: kept.contentHash },
        action,
        role,
        variables: {},
        about: { category, spent },
        fromWallet: { typed: variables },
      };
    }
    return {
      template: { identifier: kept.identifier, contentHash: kept.contentHash, ...(kept.declaration === undefined ? {} : { declaration: kept.declaration.contentHash }) },
      action,
      role,
      variables,
      tokens: [category],
    };
  }
}
