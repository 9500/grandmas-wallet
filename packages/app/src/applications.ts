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

import { TYPEABLE, actionShape, applicationInputs, expressionVariable, offeredAt, paysTo, spendingInputs } from './action-shape.js';
import { type ActionFinding, actionFinding, findingReason, templateFindings, thisWalletRefuses } from './findings.js';
import type { ReservedAddress, Sent, TokenCoin, WalletParts } from './owner-wallet.js';
import { coinsAt } from './positions.js';
import { type RecoveryArrangement, type StoreAt, writeRecord } from './recovery-flow.js';
import { type PositionRecordCheck, type PositionRecordVerdict, checkPositionRecord, recordsDue, samePosition, sameRecord, sameNft } from './position-records.js';
import { type PresentedTexts, type TemplateNames, readPresented } from './template-check.js';

/**
 * Applications (proposal sections 12 to 14): carrying out an action of a template the wallet has never
 * seen, with the wallet's own coins and addresses; saying what a template is and what each of its actions
 * would leave behind; and listing, from the tokens the wallet holds and its own records, the positions they
 * control.
 *
 * Nothing here knows any application. Everything the wallet does for one comes from three things, none of
 * them written for this wallet: the application's template, the request, and the wallet's own position
 * records (section 13.3).
 *
 * The XO engine builds each transaction from the template. Before that, this code works the same
 * transaction out by itself: to choose coins and the exact fee, and to show the user figures that the
 * application cannot influence. What the engine built is then compared with what was worked out, and a
 * difference stops the action before anything is sent.
 */

const hex = binToHex;

/** The kinds of output an application leaves to the wallet, named by a request where it is not a plain receipt (section 13.3). */
export const BINDING_KINDS = ['receive', 'change', 'return', 'lasting'] as const;
export type BindingKind = (typeof BINDING_KINDS)[number];

/**
 * A template the user trusted on this device. Plain data. A device of the second design may have kept a recovery
 * declaration beside it; that is not read.
 */
export interface KeptTemplate {
  identifier: string;
  contentHash: string;
  /** The template as the text it arrived in. */
  text: string;
  name: string;
  /** Unix seconds. */
  trustedAt: number;
  /** The applications in a session with which the user trusted it, by the name of each pairing. */
  applications: string[];
  /** A backup store has confirmed the template's record. Until then no signature for one of its actions leaves the wallet. */
  stored: boolean;
  /**
   * A record of a position made with the template, written by an earlier seed, has been confirmed by the chain
   * (section 10.4): the template has come back once (section 14.3).
   */
  cameBack?: boolean;
  /** How many times the user had stopped trusting it before this trust. The backup's record of it carries the same number. */
  renewal?: number;
}

/**
 * Which template made a token, as the second design noted it. No longer written; read as a hint of which template to
 * show for the token, and nothing else rests on it (section 10.4).
 */
export interface TokenNote {
  category: string;
  templateIdentifier: string;
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
  /**
   * The position the action is about, by the category of the wallet's token, and whether the action spends that
   * token. Paying into a position is about its token and does not spend it. Where the template gives the token an
   * input of its own, an action whose transaction has that input spends it, whatever this says.
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
   * the page's choice among the contracts every user of the application shares, and, for a position at a script
   * many users share, the coin that is the position. The wallet reads each from the chain and finds which of the
   * template's scripts it is at. It looks for no such coin itself.
   */
  inputs?: Record<string, string>;
  /** The application that asks, by the name of its pairing. Absent when the user acts from the wallet itself. */
  application?: string;
  /** The address of the application's page, where the request came from one. It goes into the position's record. */
  page?: string;
}

/** The backup archive, as far as templates, token notes of the second design and position records need it. */
export interface ApplicationArchive {
  write(entry: RecordEntry): Promise<WriteResult>;
  /** The templates, notes and position records in the archive, each with whose it is: the current owner's, or an earlier one's. */
  read(): Promise<{
    templates: { entry: TemplateEntry; standing: Standing; withdrawn?: number }[];
    tokenNotes: { entry: TokenNoteEntry; standing: Standing }[];
    positions?: { entry: PositionRecordEntry; standing: Standing }[];
  }>;
  /** Whether a store of the archive answers now. It says nothing about a later write, which is confirmed on its own. */
  reachable?(): Promise<boolean>;
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
    reachable: async () => {
      const current = options.arrangement();
      if (current === undefined) return false;
      const answers = await Promise.all(current.archive.stores.map((address) => options.storeAt(address).list(current.archive.archiveId).then(() => true, () => false)));
      return answers.includes(true);
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

/**
 * The wallet refuses an action because of what it would leave behind (sections 12.3 and 12.5): something that would not
 * come back after the phone is lost, or something of which the wallet cannot tell. Refused before the user is asked.
 */
export class FindingRefusalError extends ActionRefusedError {
  constructor(readonly finding: ActionFinding) {
    super(findingReason(finding));
    this.name = 'FindingRefusalError';
  }
}

/**
 * What a template says about itself, and what the wallet can say about it (section 14.3): what a program can see,
 * and no more. It does not call a template verified.
 */
export interface TemplateSummary extends TemplateNames {
  name: string;
  description: string;
  actions: { action: string; name: string; description: string }[];
  /** Whether the user has trusted it on this device. */
  trusted: boolean;
  /**
   * The template has come back once: a token made with it has led to its position after a recovery, through a
   * record that the chain confirmed (section 14.3). It says nothing about an audit of its contracts.
   */
  cameBack?: true;
  /**
   * What each of its actions would leave behind (section 12.3), as the wallet names it when the template is shown.
   * This wallet refuses the actions whose finding is not that they come back, and only those.
   */
  findings: ActionFinding[];
}

export interface MovedOutput {
  satoshis: bigint;
  token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } };
}

/** Where an output of the wallet's comes from: a kind of address (named by the request, or a plain receipt), what is left over, or tokens left over. */
export type WalletOutputKind = BindingKind | 'left over' | 'token change';

/** What an action comes to: the template's words, and the wallet's own figures from the transaction it worked out. */
export interface ActionPreview {
  template: TemplateSummary;
  /**
   * What the action leaves behind (section 12.3), exposed so that another wallet could answer it otherwise. This
   * wallet previews only actions whose finding it carries out.
   */
  finding?: ActionFinding;
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
  /**
   * The template's name for the output that made the token (section 13.3), for a template the user trusts: with the
   * template's name, what the wallet calls the token. The template's claim.
   */
  tokenName?: string;
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
  /** The address of the application's page, as the record names it: where an action that needs the application is done. */
  page?: string;
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

/**
 * A token the wallet holds, with what the wallet knows about it. A token is shown by its category, a fungible
 * amount in raw units; an NFT that a record ties to a template the user trusts also by the template's name for the
 * output that made it (section 13.3).
 */
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
  /**
   * - `position`: a record of the wallet's ties the NFT to a template the user trusts. Where the position stands,
   *   `recordedPositions` says, after checking the record against the chain.
   * - `incomplete`: a record, or a note of the second design, names a template that is not trusted on this device;
   *   the reason is given. The token is held and swept all the same.
   * - `unknown`: nothing of the wallet's ties the token to a position. It is held, swept and can be sent. A note of the
   *   second design may still say which template made it (`template`).
   */
  meaning: 'position' | 'incomplete' | 'unknown';
  reason?: string;
  /** The template a record or a note names: a hint of which template to show for the token. */
  template?: { identifier: string; name: string };
  /** For an NFT a record ties to a template the user trusts: the template's name for the output that made it. The template's claim. */
  tokenName?: string;
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
  token?: TokenCoin;
  /** The wallet has no coin that can define a new token: it pays itself this much first. */
  payItself?: bigint;
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

const tokenOf = (coin: AccountCoin): { category: Uint8Array; commitment: Uint8Array; capability: 'none' | 'mutable' | 'minting' } | undefined => {
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

/**
 * The template's name for the output that made a record's token (section 13.3): an output that carries an NFT at an
 * address the role provides, whose category is a variable that holds the token's category in the record.
 */
const recordTokenName = (definition: ReadTemplate['definition'], entry: PositionRecordEntry): string | undefined => {
  const category = entry.token?.category;
  if (category === undefined) return undefined;
  const holding = new Set(Object.entries({ ...entry.values, ...(entry.variables ?? {}) }).flatMap(([variable, value]) => (value === category ? [variable] : [])));
  for (const [identifier, output] of Object.entries(definition.outputs ?? {})) {
    const { name, lockingScript, token } = output as { name?: string; lockingScript?: string; token?: { category?: unknown; nft?: unknown } | null };
    if (token?.nft === undefined || token.nft === null || expressionVariable(lockingScript) === undefined) continue;
    const variable = expressionVariable(token.category);
    if (variable !== undefined && holding.has(variable)) return name ?? identifier;
  }
  return undefined;
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

  /** The wallet's own outputs of the action sent last, until the key holder lists them (`awaitOwnOutputs`). */
  private awaiting: { transactionId: string; outpoints: string[]; since: number } | undefined;

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

  /**
   * Whether the wallet has a template, by the names a request gives it: its identifier and the hash of its text. A
   * different text under the same identifier is another template.
   */
  has(names: TemplateNames): boolean {
    return this.keptTemplate(names) !== undefined;
  }

  /** The template of a request: the wallet's own copy of one it trusts, or what the request presents, checked against its names. */
  private templateOf(request: Pick<ApplicationAction, 'template' | 'presented'>): { template: ReadTemplate; kept?: KeptTemplate; texts?: PresentedTexts } {
    const kept = this.keptTemplate(request.template);
    if (kept !== undefined) return { template: readTemplate(kept.text), kept };
    if (request.presented === undefined) return refuse('This wallet does not have that template. Send the template with the request.');
    return { template: readPresented(request.template, request.presented), texts: request.presented };
  }

  private summary(template: ReadTemplate, kept: KeptTemplate | undefined): TemplateSummary {
    const { definition } = template;
    return {
      identifier: template.identifier,
      contentHash: template.contentHash,
      name: definition.name ?? 'Unnamed template',
      description: definition.description ?? '',
      actions: Object.entries(definition.actions ?? {}).map(([action, { name, description }]) => ({ action, name: name ?? action, description: description ?? '' })),
      trusted: kept !== undefined,
      ...(kept?.cameBack === true ? { cameBack: true } : {}),
      findings: templateFindings(definition),
    };
  }

  /**
   * What a template is and what the wallet can say about it, without taking it in.
   * @throws PresentationError if it is not what the names say, or a template this wallet cannot run
   */
  describe(names: TemplateNames, presented?: PresentedTexts): TemplateSummary {
    const { template, kept } = this.templateOf({ template: names, ...(presented === undefined ? {} : { presented }) });
    return this.summary(template, kept);
  }

  /**
   * Trust a template on the user's word, and store it in the backup. Storing may fail; the template is then
   * trusted on this device and not yet stored, and no signature for one of its actions leaves the wallet.
   */
  async trust(names: TemplateNames, presented: PresentedTexts | undefined, application?: string): Promise<KeptTemplate> {
    let kept = this.keptTemplate(names);
    if (kept === undefined) {
      const suggestion = this.suggestions.find((suggested) => suggested.identifier === names.identifier && suggested.contentHash === names.contentHash);
      const texts = presented ?? suggestion?.texts;
      if (texts === undefined) return refuse('This wallet does not have that template.');
      // Trust given again after it was withdrawn. Where the backup has the withdrawal, the template is stored
      // again under the next number, which the withdrawal does not reach; where it has not, nothing there changed.
      const withdrawn = suggestion?.withdrawn;
      const renewal = withdrawn === undefined ? 0 : withdrawn.stored ? withdrawn.renewal + 1 : withdrawn.renewal;
      const read = readPresented(names, texts);
      // The backup's record of the withdrawn trust serves again where the backup was never told of the withdrawal.
      const asStored = withdrawn !== undefined && !withdrawn.stored;
      kept = {
        identifier: read.identifier,
        contentHash: read.contentHash,
        text: read.text,
        name: read.definition.name ?? 'Unnamed template',
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
  private async named(request: Pick<ApplicationAction, 'about'>): Promise<PositionToken[]> {
    const category = request.about?.category;
    if (category === undefined) return [];
    return (await this.wallet.tokenCoins()).flatMap(({ coin }) => {
      const { token } = coin.utxo.output;
      return token?.nft === undefined || hex(token.category) !== category ? [] : [{ category, commitment: hex(token.nft.commitment), capability: token.nft.capability }];
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
    const result = await archive.write(templateEntry(kept.identifier, kept.text, kept.renewal ?? 0));
    if (!safelyStored(result)) {
      throw new NotStoredError(`No backup store confirmed the template: ${result.failed.map((failure) => `${failure.store}: ${failure.reason}`).join('; ') || 'none is configured'}. Nothing was signed. Try again when a store can be reached.`);
    }
    return this.updateTemplate(kept.identifier, { stored: true });
  }

  /**
   * Whether a backup store answers now, for an action whose template or record has to be stored before it is signed
   * (section 10.5). Where none does, this wallet does not offer the action for approval; where one does, the write is
   * still confirmed on its own before anything is signed.
   */
  async backupAnswers(): Promise<boolean> {
    const { archive } = this.options;
    if (archive === undefined) return false;
    if (archive.reachable === undefined) return true;
    return archive.reachable().catch(() => false);
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
      name: kept.name,
      texts: { template: kept.text },
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
   * Work an action out: the transaction, its coins and its exact fee, before the user is asked, from the template, the
   * request and the wallet's records alone (section 13.3).
   */
  private async plan(request: ApplicationAction, definingCoin?: AccountCoin): Promise<Plan> {
    const { template } = this.templateOf(request);
    this.judge(template, request);
    await this.awaitOwnOutputs();
    const frame = await this.frame(request, template);
    return this.complete(frame, request, definingCoin);
  }

  /**
   * What the action would leave behind (section 12.3), and this wallet's answer to it (section 12.5): an action it
   * refuses goes no further, and nothing of it is worked out, stored or signed.
   * @throws FindingRefusalError where this wallet refuses
   */
  private judge(template: ReadTemplate, request: Pick<ApplicationAction, 'action' | 'role'>): ActionFinding | undefined {
    const finding = actionFinding(template.definition, request.action, request.role);
    if (finding !== undefined && thisWalletRefuses(finding)) throw new FindingRefusalError(finding);
    return finding;
  }

  /**
   * The second half of working an action out, the same for every template: the coin that defines a new token
   * category, the template's outputs, the wallet's tokens and coins, the exact fee, the places in the
   * transaction, the checks of what the wallet's tokens come to, and the application's contracts run against the
   * transaction as worked out.
   */
  private async complete(frame: Frame, request: ApplicationAction, definingCoin?: AccountCoin): Promise<Plan> {
    const { template, values, kinds, leftOver, walletScripts, creates, applicationCoins, follow, following, token } = frame;
    const { definition } = template;
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

    // The coin at the template's input for the token is the token (the engine does not look), and what becomes of
    // the wallet's tokens is shown, and asks for the user's tick (section 13.3).
    if (spentAsItem && token !== undefined) this.tokenInputHolds(definition, frame.tokenInput?.input as string, token, values);
    const tokensLeaving = leavingTokens(definition, planned, spentToken === undefined ? undefined : token, creates === undefined ? undefined : String(values[creates]));

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
      ...(token === undefined ? {} : { token }),
      ...(payItself === undefined ? {} : { payItself }),
      ...(tokensLeaving.length === 0 ? {} : { tokensLeaving }),
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
   * The first half of working an action out (section 13.3).
   *
   * - **The token.** The request names the position by its token's category and says whether the action spends
   *   it. Where the template gives the token an input of its own, an action whose transaction has it spends it.
   * - **The record.** Of the records of that token and template, the one at a script the action spends, continues
   *   or pays into, as the wallet lists it from the chain: open before closed before not confirmed.
   * - **Each value the role provides,** from the first that applies: (1) the record, for the values of the
   *   position's own script; (2) the wallet itself: a token category the action creates, the category of the token
   *   the action is about where an output names the variable as its token's category and no input does, a locking
   *   script the request does not supply (of the kind the request names, a plain receipt where it names none), and
   *   the category of the template's input for the token from the token itself; (3) the request; (4) the record's
   *   other values, in an action that spends the position; (5) the user, for a value a person can type, when the
   *   wallet acts by itself. A variable nothing fills stops the action, named.
   * - **The application's coins:** each that the request names by outpoint, read from the chain and matched to a
   *   script of the template by its bytecode; and the position's coins at the record's script, for the input whose
   *   unlocking that script names. The wallet looks for no other coin of the application's.
   */
  private async frame(request: ApplicationAction, template: ReadTemplate): Promise<Frame> {
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
    const category = request.about?.category;
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
    // A category is made only once. One that the request gives as that of the wallet's own token, or of a token on a
    // coin the request names, is not made now: the action carries it on, as a contract that mints from its own coin does.
    const existing = new Set(category === undefined ? [] : [category]);
    for (const outpoint of Object.values(request.inputs ?? {})) {
      const token = (await this.namedOutput(outpoint))?.token;
      if (token !== undefined) existing.add(hex(token.category));
    }
    // Where the request says which token the action is about, that token's category is the value of a variable an
    // output names as its token's category and no input does, unless the request says the action makes it now.
    const aboutCategory = (variable: string): boolean => category !== undefined && supplied(variable) === undefined && request.creates !== variable && shape.creating.includes(variable);
    const creating = shape.creating.filter((variable) => !aboutCategory(variable) && !existing.has(String(supplied(variable) ?? '')));
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
      if (aboutCategory(variable)) {
        raw[variable] = category as string;
        continue;
      }
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

  /** The output a request names as `<transaction id>:<output index>`, as the chain has it; `undefined` where there is none. */
  private async namedOutput(outpoint: string): Promise<Output | undefined> {
    const [transactionId = '', index = ''] = outpoint.split(':');
    if (!/^[0-9a-f]{64}$/.test(transactionId) || !/^\d{1,5}$/.test(index)) return undefined;
    const text = await this.wallet.chain.getTransaction(transactionId);
    const transaction = text === undefined ? undefined : decodeTransactionBch(hexToBin(text));
    return transaction === undefined || typeof transaction === 'string' ? undefined : transaction.outputs[Number(index)];
  }

  /**
   * A coin of the application's that a request names by outpoint. The wallet reads it from the chain and does not take the request's word for what it holds. Which of the
   * template's scripts it sits at, the wallet finds by comparing its locking bytecode with each script the
   * template gives, made with the action's values; the script whose unlocking is the input's is tried first. A
   * coin at no script of the template is refused, and so is one that is spent.
   */
  private async namedCoin(definition: ReadTemplate['definition'], input: string, outpoint: string, values: TemplateValues): Promise<{ utxo: Utxo; lockingScript: string }> {
    const name = definition.inputs?.[input]?.name ?? input;
    const [transactionId = '', index = ''] = outpoint.split(':');
    if (!/^[0-9a-f]{64}$/.test(transactionId) || !/^\d{1,5}$/.test(index)) return refuse(`The request names the coin for "${name}" in a form this wallet does not read.`);
    const output = await this.namedOutput(outpoint);
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

  /**
   * What an action would do, for the user to decide on. Nothing is stored, signed or sent, and no address is taken.
   *
   * @throws ActionRefusedError with the reason when the wallet would not carry the action out;
   * InsufficientFundsError, with the figures, when the wallet's coins do not cover it
   */
  async preview(request: ApplicationAction): Promise<ActionPreview> {
    this.wallet.requireUsable();
    const { template, kept } = this.templateOf(request);
    const summary = this.summary(template, kept);
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
    const finding = actionFinding(definition, request.action, request.role);
    return {
      template: summary,
      ...(finding === undefined ? {} : { finding }),
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
    // The next action waits for the key holder to list what this one left the wallet (`awaitOwnOutputs`).
    this.awaiting = { transactionId: prepared.transactionId, outpoints: plan.outputs.flatMap(({ wallet }, index) => (wallet === undefined ? [] : [`${prepared.transactionId}:${index}`])), since: Date.now() };
    if (await this.ownOutputsListed(this.awaiting)) this.awaiting = undefined;
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

  /** Whether the key holder lists every output of the wallet's of an action it sent. */
  private async ownOutputsListed(awaiting: NonNullable<Applications['awaiting']>): Promise<boolean> {
    const listed = new Set((await this.wallet.backend.coins()).map((coin) => outpointOf(coin.utxo)));
    return awaiting.outpoints.every((outpoint) => listed.has(outpoint));
  }

  /**
   * Before an action is worked out, wait until the key holder lists what the action sent just before left the wallet:
   * its change, and the tokens it gave the wallet. The key holder spends only coins it lists, and it learns of them
   * from its server a moment after the transaction is sent, when the server has taken the transaction into its
   * pool; the wallet cannot hand them to it sooner. This is a wait for the server, never for a block: after half a
   * minute from the sending, the action is worked out with what is listed.
   */
  private async awaitOwnOutputs(): Promise<void> {
    const { awaiting } = this;
    if (awaiting === undefined) return;
    while (!(await this.ownOutputsListed(awaiting)) && Date.now() - awaiting.since < 30_000) await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.awaiting === awaiting) this.awaiting = undefined;
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
   * Take in what the backup holds about applications: templates, position records, and the token notes of the second
   * design. A template that this seed stored is trusted, as it was when it was stored. One that an earlier owner
   * stored is a suggestion from that time and is not trusted here (section 10.3). A template's record of the second
   * design may hold a recovery declaration beside the template; only the template is taken. Notes are hints.
   */
  async readBackup(): Promise<{ suggested: number; notes: number }> {
    const { archive } = this.options;
    if (archive === undefined) return { suggested: 0, notes: 0 };
    const { templates, tokenNotes, positions = [] } = await archive.read();
    const same = (a: Pick<TemplateNames, 'identifier' | 'contentHash'>, b: Pick<TemplateNames, 'identifier' | 'contentHash'>): boolean => a.identifier === b.identifier && a.contentHash === b.contentHash;
    let suggested = [...(this.state.suggested ?? [])];
    for (const { entry, standing, withdrawn } of templates) {
      const names: TemplateNames = { identifier: entry.identifier, contentHash: entry.contentHash };
      const texts: PresentedTexts = { template: entry.text };
      if (this.keptTemplate(names) !== undefined) continue;
      try {
        const renewal = entry.renewal ?? 0;
        const local = suggested.find((known) => same(known, names))?.withdrawn;
        if (standing === 'current owner' && withdrawn !== undefined) {
          // This seed stopped trusting it: a suggestion, which remembers the withdrawal's number.
          const known = suggested.find((candidate) => same(candidate, names));
          if (known?.withdrawn === undefined || known.withdrawn.renewal < withdrawn || !known.withdrawn.stored) {
            suggested = [...suggested.filter((candidate) => !same(candidate, names)), { ...names, name: readPresented(names, texts).definition.name ?? 'Unnamed template', texts, withdrawn: { renewal: Math.max(withdrawn, known?.withdrawn?.renewal ?? 0), stored: true } }];
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
          suggested.push({ ...names, name: readPresented(names, texts).definition.name ?? 'Unnamed template', texts });
        }
      } catch {
        // A record that cannot be read as a template is passed over: it is a hint, and a bad one.
      }
    }
    const notes = [...this.state.notes];
    for (const { entry } of tokenNotes) {
      if (!notes.some((note) => note.category === entry.category)) notes.push({ category: entry.category, templateIdentifier: entry.templateIdentifier });
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
        const definition = this.state.templates.some((kept) => kept.identifier === item.entry.templateIdentifier) ? trusted(item.entry.templateIdentifier)?.definition : undefined;
        const tokenName = definition === undefined ? undefined : recordTokenName(definition, item.entry);
        return {
          token,
          template: { identifier: item.entry.templateIdentifier, ...(name === undefined ? {} : { name }) },
          ...(tokenName === undefined ? {} : { tokenName }),
          status,
          ...(reason === undefined ? {} : { reason }),
          record: item.entry,
          standing: item.standing,
          ...(item.script === undefined ? {} : { lockingBytecode: item.script, ...(await holds(item.script)) }),
          ...(actions === undefined ? {} : { actions }),
          ...(item.entry.applicationPage === undefined ? {} : { page: item.entry.applicationPage }),
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
   * Every token the wallet holds, with what the wallet knows about it (sections 10.4 and 13.3). A token is never left
   * out. A record of the wallet's, or a note of the second design, says which template to show for it; nothing else
   * does. Where that template is not trusted on this device, the token is listed as incomplete, with the reason.
   */
  async tokens(): Promise<HeldToken[]> {
    const records = [...this.positionRecords, ...this.suggestedRecords];
    const held: HeldToken[] = [];
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
      // A record names the NFT it was written for; a note of the second design only the category.
      const record = token.nft === undefined ? undefined : (records.find((entry) => entry.token?.category === category && this.keptById(entry.templateIdentifier) !== undefined) ?? records.find((entry) => entry.token?.category === category));
      const note = record === undefined ? this.state.notes.find((candidate) => candidate.category === category) : undefined;
      const identifier = record?.templateIdentifier ?? note?.templateIdentifier;
      if (identifier === undefined) {
        held.push({ ...base, meaning: 'unknown' });
        continue;
      }
      const kept = this.keptById(identifier);
      if (kept !== undefined) {
        const tokenName = record === undefined ? undefined : recordTokenName(readTemplate(kept.text).definition, record);
        held.push({
          ...base,
          meaning: record === undefined ? 'unknown' : 'position',
          template: { identifier, name: kept.name },
          ...(tokenName === undefined ? {} : { tokenName }),
          ...(record === undefined ? { reason: `A note of an earlier version of this wallet says the template "${kept.name}" made this token. No record of this wallet ties it to a position.` } : {}),
        });
        continue;
      }
      const suggested = this.suggestions.find((template) => template.identifier === identifier);
      const said = record === undefined ? 'A note of an earlier version of this wallet says' : 'A record of this wallet says';
      held.push({
        ...base,
        meaning: 'incomplete',
        reason:
          suggested === undefined
            ? `${said} which template made this token, and that template is not on this device. The token is safe; what it controls cannot be shown or operated until the template is had again.`
            : suggested.withdrawn !== undefined
              ? `${said} the template "${suggested.name}" made this token. You stopped trusting that template.`
              : `${said} the template "${suggested.name}" made this token. An earlier owner of the wallet stored that template; it is not trusted on this device yet.`,
        ...(suggested === undefined ? {} : { template: { identifier: suggested.identifier, name: suggested.name } }),
      });
    }
    return held;
  }

  private keptById(identifier: string): KeptTemplate | undefined {
    return this.state.templates.find((template) => template.identifier === identifier);
  }

  /**
   * The positions of one template the wallet lists from its records, for the application that asks (section 14.2):
   * each token a record ties to the template, with where its position stands. A token without a
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
   * the script offers the record's role. Each says what the user is asked to type, or, where the action needs a
   * coin or a value that only the application gives, that it is done through the application, with the page the
   * record names. An action that spends the position is not offered once it is closed, and one that only pays into
   * it is not offered while it is not confirmed. A record that names no script offers nothing here: what its token
   * controls is the application's to show, at the page the record names (`RecordedPosition.page`).
   */
  offeredActions(position: Pick<RecordedPosition, 'template' | 'record' | 'status'>): TokenAction[] {
    const kept = this.keptById(position.template.identifier);
    const { record } = position;
    const script = record.lockingScriptIdentifier;
    const role = record.roleIdentifier;
    if (kept === undefined || script === undefined || role === undefined) return [];
    const { definition } = readTemplate(kept.text);
    const page = record.applicationPage;
    const described = (variable: string) => ({ variable, name: definition.variables?.[variable]?.name ?? variable, description: definition.variables?.[variable]?.description ?? '', type: String(variableType(definition, variable) ?? 'bytes') });
    return offeredAt(definition, script, role).flatMap((action): TokenAction[] => {
      const shape = actionShape(definition, action, role);
      if (typeof shape === 'string') return [];
      const positionInputs = spendingInputs(definition, shape, script);
      const spendsPosition = positionInputs.length > 0;
      if (spendsPosition && position.status === 'closed') return [];
      // At a position that is not confirmed, money can be taken out and none is paid in (section 10.4).
      if (!spendsPosition && position.status === 'unconfirmed' && paysTo(definition, shape, script)) return [];
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
   * An action on a position, as the user asks for it from the wallet itself, with the application's page not
   * consulted: everything comes from the template and the record (section 13.3). The token is the record's, and the
   * action spends it where the template gives it an input of its own or the action spends the position; what the
   * user typed comes after the record and the wallet's own values.
   */
  actionOn(position: Pick<RecordedPosition, 'token' | 'template' | 'record'>, action: string, variables: Record<string, string | number> = {}): ApplicationAction {
    const kept = this.keptById(position.template.identifier);
    if (kept === undefined) return refuse('The template of this token is not trusted on this device.');
    const { definition } = readTemplate(kept.text);
    const described = definition.actions?.[action];
    const recordRole = position.record.roleIdentifier;
    const [role] = recordRole !== undefined && described?.roles?.[recordRole] !== undefined ? [recordRole] : Object.keys(described?.roles ?? {});
    if (role === undefined) return refuse(`The template "${kept.name}" has no action "${action}".`);
    const shape = actionShape(definition, action, role);
    const script = position.record.lockingScriptIdentifier;
    const spent = typeof shape !== 'string' && (shape.tokenInput !== undefined || (script !== undefined && spendingInputs(definition, shape, script).length > 0));
    return {
      template: { identifier: kept.identifier, contentHash: kept.contentHash },
      action,
      role,
      variables: {},
      about: { category: position.token.category, spent },
      fromWallet: { typed: variables },
    };
  }
}
