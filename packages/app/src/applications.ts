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
  type RegistryToken,
  type FollowedScript,
  type PreparedTransaction,
  type ReadTemplate,
  type SeedKeys,
  type SharedActionFinish,
  type SharedInvitationStarted,
  type TemplateValues,
  type Utxo,
  ADDRESS_KIND,
  INPUT_BYTES,
  TemplateError,
  chooseCoins,
  readControllerHistory,
  readTemplate,
  requiredFee,
  outputsToScriptInRole,
  smallestOutputValue,
  templateLockingBytecode,
  templateOmittedSatoshis,
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

import { type ServiceItem, type ServiceResource, LARGEST_TEMPLATE_TEXT, SERVICE_LIMITS, findServiceResource } from '@grandmas-wallet/connect';

import { TYPEABLE, actionShape, applicationInputs, expressionVariable, offeredAt, paysTo, spendingInputs } from './action-shape.js';
import {
  type KeptService,
  type MadeCategory,
  type ServiceOffer,
  type ServiceOptions,
  type ServicePart,
  type ServiceStatus,
  askedValues,
  checkServiceItem,
  firstCommitPlaces,
  otherParticipants,
  startEntriesOf,
  startingActionsOf,
  saidValue,
  statedValue,
  walletRoleOf,
} from './application-services.js';
import { type ServiceCallFailure, type ServiceCallOptions, SERVICE_WORDS, askServiceHello, askServiceJoin, askServicePossible, servedRole } from './service-client.js';
import { SHARED_ANSWER_LIMIT_MS, takeJoinedInvitation } from './shared-action.js';
import { type SharedAccepted, type SharedRefusalCode, checkOtherParticipant } from './shared-checks.js';
import { type ActionFinding, actionFinding, findingReason, templateFindings, thisWalletRefuses } from './findings.js';
import type { ReservedAddress, Sent, TokenCoin, WalletParts } from './owner-wallet.js';
import { coinsAt } from './positions.js';
import { type RecoveryArrangement, type StoreAt, writeRecord } from './recovery-flow.js';
import { type PositionRecordCheck, type PositionRecordVerdict, checkPositionRecord, recordsDue, samePosition, sameRecord, sameNft } from './position-records.js';
import { builtDifference, coinScriptOf, inputBytes, sameToken } from './planned.js';
import { type PresentedTexts, type TemplateNames, PresentationError, readPresented } from './template-check.js';
import { WALLET_TEMPLATES, templateIdentifier } from './templates.js';
import { type ShownRegistry, shownRegistry } from './token-registry.js';

/** Whether two things name the same template text. */
const sameNames = (a: Pick<TemplateNames, 'identifier' | 'contentHash'>, b: Pick<TemplateNames, 'identifier' | 'contentHash'>): boolean => a.identifier === b.identifier && a.contentHash === b.contentHash;

/** Two held categories shown with the same symbol are each marked, so that the screens write the category beside it. */
const markSameSymbols = (held: HeldToken[]): HeldToken[] => {
  const categories = new Map<string, Set<string>>();
  for (const token of held) if (token.registry !== undefined) categories.set(token.registry.symbol, (categories.get(token.registry.symbol) ?? new Set()).add(token.category));
  return held.map((token) => (token.registry !== undefined && (categories.get(token.registry.symbol)?.size ?? 0) > 1 ? { ...token, registry: { ...token.registry, sameSymbol: true } } : token));
};

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

/** The identifiers of the wallet's own templates, worked out once: they are built in, never trusted, stopped or deleted. */
let builtIn: Set<string> | undefined;
const builtInIdentifiers = (): Set<string> => (builtIn ??= new Set(Object.values(WALLET_TEMPLATES).map(templateIdentifier)));

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
  /** The user added it on this device, from a file or as text they pasted; no application offered it. */
  from?: 'file';
}

/**
 * A template the user deleted from the wallet: all the device keeps of it, its names and the number of the withdrawal
 * that marks it deleted in the backup, so that reading the backup does not offer it again and trusting it again
 * stores it under a number that mark does not reach. Its text is gone from the device.
 */
export interface DeletedTemplate extends TemplateNames {
  renewal: number;
  /** A backup store has confirmed the mark. Until then it is written again whenever the backup is read. */
  stored: boolean;
  /** A store had confirmed a withdrawal under the same number before the deletion: the backup's record of it is withdrawn either way. */
  withdrawnBefore?: true;
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
  /**
   * What the wallet last heard from the service of each template the user trusts (docs/xo-service.md). A note of what a
   * server said, kept on this device only: the backup holds templates and records, and a service is asked again.
   */
  services?: KeptService[];
  /** Token categories the wallet created with templates' actions, for their services; kept on this device only. */
  made?: MadeCategory[];
  /** Templates the user deleted from the wallet. */
  deleted?: DeletedTemplate[];
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
  fromWallet?: { typed: Record<string, string | number>; script?: string };
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
    templates: { entry: TemplateEntry; standing: Standing; withdrawn?: number; deleted?: true }[];
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
 * What the nodes say when a transaction spends a coin that another transaction spent first, in the pool or in a
 * block, or one that is not there: Bitcoin Cash Node's `txn-mempool-conflict` (code 18) and
 * `bad-txns-inputs-missingorspent` (code 16), and the older wordings `missing-inputs`, `Missing inputs` and
 * `bad-txns-inputs-spent`. The engine passes the node's refusal on as text inside its own messages
 * (docs/xo-feedback-notes.md, 16 Nov 2026), so the refusals are told apart by their words. A conflict the engine
 * finds among its own invitations is not one of them: nothing reached the network.
 */
const INPUTS_SPENT = /txn-mempool-conflict|inputs-missingorspent|missing[- ]inputs|inputs-spent/i;

/** Whether a refusal of the network's says that one of the transaction's coins was spent first, or is not there. */
export const inputsSpentRefusal = (message: string): boolean => INPUTS_SPENT.test(message);

/**
 * The network refused the action's transaction: another transaction spent one of its coins first, or a coin it names
 * is not there. Nothing was sent, and the wallet's own coins in it are free again. The application may read its coins
 * again and ask anew: the code says so (`ActionResult.code`).
 */
export class InputsSpentError extends Error {
  readonly code = 'inputs-spent' as const;
  constructor(message: string) {
    super(message);
    this.name = 'InputsSpentError';
  }
}

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
  /**
   * The service the template names for this wallet's network (docs/xo-service.md), as the template describes it: its
   * address, or why the address cannot be used. Nothing is asked of it to say this.
   */
  service?: { description: string; url?: string; problem?: string };
}

/**
 * What the wallet keeps that a template's deletion would leave without its template (`Applications.deletionHolds`): the
 * tokens it holds that a record or note ties to the template, the positions recorded with it that are not closed, and the
 * tokens it made with the template that wait elsewhere. Where any is there, the deletion needs the user's confirmation.
 */
export interface DeletionHolds {
  tokens: HeldToken[];
  open: RecordedPosition[];
  /** Token categories the wallet made with the template, not in the wallet. */
  waiting: string[];
  /** The tokens or records could not be read: nothing can be said, and the deletion is confirmed as if something were held. */
  unknown?: true;
}

/** Whether a deletion leaves something without its template, or cannot tell: then the user confirms it. */
export const deletionNeedsConfirming = (holds: DeletionHolds): boolean => holds.unknown === true || holds.tokens.length + holds.open.length + holds.waiting.length > 0;

/** A deletion that leaves tokens or open positions without their template, asked without the user's confirmation. Nothing was deleted. */
export class DeletionNotConfirmedError extends ActionRefusedError {
  constructor(readonly holds: DeletionHolds) {
    super('This wallet holds tokens of this template, or positions made with it. Confirm the deletion: the wallet will not operate them until the template is added again. Nothing was deleted.');
    this.name = 'DeletionNotConfirmedError';
  }
}

/** Why a file the user chose is not taken in as a template. */
export type TemplateFileProblem = 'empty' | 'too large' | 'not json' | 'not a template';

/** A file the user chose is not a template this wallet takes in, in plain words. Nothing was trusted or stored. */
export class TemplateFileError extends Error {
  constructor(
    readonly problem: TemplateFileProblem,
    message: string,
  ) {
    super(message);
    this.name = 'TemplateFileError';
  }
}

/** The largest template a file may hold, in characters: what an application's offer may carry. */
export const LARGEST_TEMPLATE_FILE = LARGEST_TEMPLATE_TEXT;

/** What the user is told of a file too large to be a template. */
export const TEMPLATE_FILE_TOO_LARGE = `The file is too large for a template. A template can have at most ${LARGEST_TEMPLATE_FILE.toLocaleString('en-US')} characters.`;

/**
 * A template read from a file the user chose (`Applications.readTemplateFile`), checked as an application's offer is:
 * - `new`: to be reviewed, and trusted or declined;
 * - `suggested`: the same text as one the backup holds and this device does not trust; trusting it trusts that one;
 * - `trusted`: this device trusts it already.
 */
export type TemplateFile =
  | { kind: 'new' | 'suggested'; names: TemplateNames; texts: PresentedTexts; summary: TemplateSummary }
  | { kind: 'trusted'; names: TemplateNames; name: string };

/** The first reason a reader gives, kept short for a screen. */
const shortReason = (message: string): string => {
  // The XO validator lists what it found, one item a line, each a field and what it expected there: the first is said.
  const item = /Template invalid:\s*-\s*([^\n]+)/.exec(message)?.[1]?.trim();
  if (item !== undefined) {
    const [, field, found] = /^([^:]+):\s*(.+)$/.exec(item) ?? [];
    const said = field === undefined || found === undefined ? item : `${field === '(root)' ? 'the file' : `"${field}"`} ${found}`;
    return said.length > 140 ? `${said.slice(0, 139)}…` : said.replace(/[.;:]$/, '');
  }
  const plain = message.replace(/^This is not a template the XO engine accepts:\s*/, '').replace(/\s+/g, ' ').trim();
  const [first] = plain.split(/(?<=[.;:])\s/);
  const reason = (first ?? plain).replace(/[.;:]$/, '');
  return reason.length > 140 ? `${reason.slice(0, 139)}…` : reason;
};

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
    /** By the template's names, with its type for each value where it gives one, so that a screen shows satoshis as an amount and numbers grouped. */
    values: { name: string; description: string; value: string; type?: string }[];
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
    /**
     * The part of the fee that coins of the application's give up to it, where its template leaves their satoshis out
     * of the change (`omitChangeAmounts`): it goes to the network, and never came from the wallet.
     */
    feeFromApplicationSatoshis?: bigint;
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
   * For an action another participant joins through the template's service: what the service stated, shown apart from
   * the wallet's own figures and checked only through the application's contracts.
   */
  service?: ServicePart;
  /**
   * Tokens that the action does not deliver to the wallet unchanged (section 13.3): the token of the wallet's it
   * spends, where it leaves the wallet, comes back changed or ends; and a token made from the wallet's own coin
   * that goes elsewhere. The action is carried out only with the user's tick: `carryOut` with `{ tokensLeave: true }`.
   */
  tokensLeaving?: TokenLeaving[];
}

/**
 * Every token category a review of the preview writes, once each: those of the wallet's own tokens first (what it
 * ends up with, spends and receives), then those of the application's coins and of what goes elsewhere.
 */
export const previewCategories = (preview: ActionPreview): string[] => {
  const { figures } = preview;
  const outputs = (moved: MovedOutput[]): string[] => moved.flatMap((output) => (output.token === undefined ? [] : [output.token.category]));
  return [
    ...new Set([
      ...figures.tokensNet.map((entry) => entry.category),
      ...outputs(figures.tokensSpent),
      ...outputs(figures.toWallet),
      ...outputs(figures.applicationInputs),
      ...outputs(figures.toOthers),
      ...figures.tokensDestroyed.map((entry) => entry.token.category),
    ]),
  ];
};

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
/**
 * The template's service gave no usable answer, so the action could not be worked out: it cannot be reached, did not
 * answer in time, or answered with something the wallet cannot read. Nothing was sent; the words are the client's.
 */
export class ServiceUnreachableError extends ActionRefusedError {
  constructor(
    message: string,
    readonly kind: ServiceCallFailure['kind'],
  ) {
    super(message);
    this.name = 'ServiceUnreachableError';
  }
}

/** The template's service answered and declined, in its own words: "The service declined: …". */
export class ServiceDeclinedError extends ActionRefusedError {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ServiceDeclinedError';
  }
}

/** The wallet refused what the service added to its invitation (`checkOtherParticipant`): nothing was signed. */
export class ServiceAnswerRefusedError extends ActionRefusedError {
  constructor(
    reason: string,
    readonly code: SharedRefusalCode,
  ) {
    super(`The service's answer was refused: ${reason} Nothing was signed.`);
    this.name = 'ServiceAnswerRefusedError';
  }
}

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
 * - `open`: a record that counts, and its script holds coins. Several records of one token can be open at once:
 *   a position that moved, and its earlier script that was paid again.
 * - `closed`: a record that counts, and its script holds nothing.
 * - `unconfirmed`: a record that does not count.
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
  /** For an action the template's service takes part in: what the service last said about it. */
  service?: ServiceOffer;
}

/** A starting action of a template, or an action for a token the wallet made that it does not hold, as the wallet offers it. */
export interface TemplateAction extends TokenAction {
  /** For an action on a token the wallet made and does not hold: its category, and the template's name for where it waits. */
  waiting?: { category: string; at: string };
}

/** What a template the user trusts offers from the wallet itself: its starting actions, and actions on tokens it made. */
export interface TemplateActions {
  template: { identifier: string; name: string };
  /**
   * The role the wallet takes, where one is settled: the role the template's service was told, or the one role of the
   * template's starting actions. Where none is, each starting action is offered under the role its entry names.
   */
  role?: string;
  /** Where the starting actions are under more than one role: the template's name for each of their roles. */
  roleNames?: Record<string, string>;
  /** The template's service, where it names one for the wallet's network. */
  service?: ServiceStatus;
  starting: TemplateAction[];
  waiting: TemplateAction[];
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
  /**
   * The issuer's words for the category, from its registry as checked against the chain and kept on this device: for
   * the screens only. Absent for an NFT a record ties to a position, which keeps the template's name.
   */
  registry?: ShownRegistry;
}

/** An action another participant joins, worked out to the satoshi and waiting for the user's approval. */
interface PendingShared {
  /** The request it was worked out for, with the position and bindings the service's item gave. */
  request: ApplicationAction;
  url: string;
  /** The role the service takes. */
  role: string;
  started: SharedInvitationStarted;
  /** The coins of the wallet's first commit. */
  committed: AccountCoin[];
  accepted: SharedAccepted;
  plan: Plan;
  /** The category the action makes, where it makes one. */
  made?: string;
  /** The service's item the action is for: absent for a starting action. */
  item?: ServiceItem;
  /** Worked out with a coin the wallet first pays itself: carried out only after a fresh round with that coin. */
  virtual: boolean;
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
  /** The part of the fee that the application's coins give up to it as their template says (`omitChangeAmounts`). */
  feeFromApplicationSatoshis?: bigint;
  bytes: number;
  token?: TokenCoin;
  /** The wallet has no coin that can define a new token: it pays itself this much first. */
  payItself?: bigint;
  /** Tokens of the wallet's, or made from its coin, that the action does not deliver to it unchanged: carried out only with the user's tick. */
  tokensLeaving?: TokenLeaving[];
  /** The position record the action took values from. */
  record?: PositionRecordEntry;
  /** The token category the action makes, where it makes one. */
  made?: string;
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
  /** Existing token categories the request gives for variables that an output names as its token's category and no input does. */
  givenCategories: string[];
  /** `state`: the values of the coin's script's state that the request gave, where the role does not provide them. */
  applicationCoins: { input: string; index?: number; utxo: Utxo; lockingScript: string; state?: TemplateValues }[];
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
 * to the wallet goes to the application, or elsewhere, and so do the wallet's tokens of a category the request gives that
 * the wallet pays. Each is shown, and asks for the user's tick.
 */
const leavingTokens = (definition: ReadTemplate['definition'], planned: PlannedOutput[], spent: TokenCoin | undefined, made: string | undefined, given: string[] = []): TokenLeaving[] => {
  const leaving: TokenLeaving[] = [];
  const outputName = (identifier: string | undefined): string | undefined => (identifier === undefined ? undefined : (definition.outputs?.[identifier]?.name ?? identifier));
  const own = spent === undefined ? undefined : nftOf(spent.coin.utxo.output.token);
  if (own !== undefined && !planned.some(({ output, wallet }) => wallet !== undefined && sameNft(nftOf(output.token), own))) {
    const ofCategory = planned.filter(({ output }) => output.token?.nft !== undefined && hex(output.token.category) === own.category && !isDataOutput(output));
    const away = ofCategory.find(({ wallet }) => wallet === undefined);
    const to = outputName((away ?? ofCategory[0])?.identifier);
    leaving.push({ token: own, how: away !== undefined ? 'leaves' : ofCategory.length > 0 ? 'changes' : 'ends', ...(to === undefined ? {} : { to }) });
  }
  // A token made now from the wallet's coin, and tokens of a category the request gave that the wallet pays from its
  // own coins: each output that is not the wallet's and carries them takes them out of the wallet.
  const categories = new Set([...(made === undefined ? [] : [made]), ...given]);
  for (const { output, wallet, identifier } of planned) {
    if (wallet !== undefined || output.token === undefined || !categories.has(hex(output.token.category))) continue;
    const category = hex(output.token.category);
    const to = outputName(identifier);
    leaving.push({
      token: { category, commitment: hex(output.token.nft?.commitment ?? new Uint8Array()), capability: output.token.nft?.capability ?? 'none', ...(output.token.amount > 0n ? { amount: output.token.amount } : {}) },
      how: isDataOutput(output) ? 'ends' : 'leaves',
      ...(category === made ? { made: true as const } : {}),
      ...(to === undefined ? {} : { to }),
    });
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
/** An NFT as the wallet's figures show it: its category and, where it has one, its capability and commitment, as hex. */
export interface NftShown {
  category: string;
  nft?: { capability: string; commitment: string } | undefined;
}

/**
 * Whether the NFT of an input can be the one on an output of the same transaction: of the same category, and changed
 * no more than its capability lets it be. A minting NFT may become any NFT of its category; a mutable one may take
 * another commitment, and may give up being mutable; one without a capability stays as it is.
 */
export const nftCanBecome = (from: NftShown, to: NftShown): boolean => {
  if (from.nft === undefined || to.nft === undefined || from.category !== to.category) return false;
  if (from.nft.capability === 'minting') return true;
  if (from.nft.capability === 'mutable') return to.nft.capability === 'mutable' || to.nft.capability === 'none';
  return to.nft.capability === 'none' && to.nft.commitment === from.nft.commitment;
};

/**
 * NFTs of a transaction's inputs matched to those of its outputs, each used once: first those that go on unchanged,
 * then those changed as their capability allows. What is left over on either side was destroyed, or made now.
 * @returns the inputs no output carries on, and the outputs no input explains
 */
export const matchNfts = <T extends NftShown, U extends NftShown>(inputs: T[], outputs: U[]): { notCarriedOn: T[]; notExplained: U[] } => {
  const free = outputs.map(() => true);
  const used = inputs.map(() => false);
  const unchanged = (from: NftShown, to: NftShown): boolean => from.category === to.category && from.nft?.capability === to.nft?.capability && from.nft?.commitment === to.nft?.commitment;
  // In the second pass the least capable go first, so that a minting NFT, which can become any NFT of its category,
  // does not take the output another input can only become.
  const rank: Record<string, number> = { none: 0, mutable: 1, minting: 2 };
  const order = inputs.map((_, index) => index);
  for (const rule of [unchanged, nftCanBecome]) {
    if (rule === nftCanBecome) order.sort((a, b) => (rank[inputs[a]?.nft?.capability ?? ''] ?? 3) - (rank[inputs[b]?.nft?.capability ?? ''] ?? 3));
    order.forEach((index) => {
      const input = inputs[index] as T;
      if (used[index] === true || input.nft === undefined) return;
      const found = outputs.findIndex((output, at) => free[at] === true && rule(input, output));
      if (found === -1) return;
      free[found] = false;
      used[index] = true;
    });
  }
  return { notCarriedOn: inputs.filter((input, index) => input.nft !== undefined && used[index] !== true), notExplained: outputs.filter((output, at) => output.nft !== undefined && free[at] === true) };
};
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
/** The variables a template lists in the state of one of its locking scripts, for the script itself and for a role. */
const stateVariables = (definition: ReadTemplate['definition'], lockingScript: string, role: string): string[] => {
  const script = definition.lockingScripts?.[lockingScript] as { state?: { variables?: string[] }; roles?: Record<string, { state?: { variables?: string[] } }> } | undefined;
  return [...new Set([...(script?.state?.variables ?? []), ...(script?.roles?.[role]?.state?.variables ?? [])])].filter((name) => definition.variables?.[name] !== undefined);
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

/** The wallet's token coins, with the one an invitation of the wallet's holds out of the list. */
const withHeld = (coins: TokenCoin[], holding: TokenCoin | undefined): TokenCoin[] =>
  holding === undefined || coins.some(({ coin }) => outpointOf(coin.utxo) === outpointOf(holding.coin.utxo)) ? coins : [...coins, holding];

/** A request, as the key of the action a review worked out for it: the same request, made again from the same entry, finds it. */
const requestKey = (request: ApplicationAction): string =>
  JSON.stringify([request.template.identifier, request.template.contentHash, request.action, request.role, request.variables, request.bindings ?? null, request.about ?? null, request.creates ?? null, request.fromWallet ?? null, request.application ?? null]);

/** What the wallet gives, less what it gets, in satoshis and in fungible tokens by category, in a transaction worked out. */
const walletBalance = (plan: Pick<Plan, 'inputs' | 'outputs'>): { satoshis: bigint; tokens: Map<string, bigint> } => {
  const given = plan.inputs.filter(({ kind }) => kind !== 'application').map(({ coin }) => coin.utxo.output);
  const got = plan.outputs.filter(({ wallet }) => wallet !== undefined).map(({ output }) => output);
  const tokens = fungible(given);
  for (const [category, amount] of fungible(got)) tokens.set(category, (tokens.get(category) ?? 0n) - amount);
  return { satoshis: sum(given.map((output) => output.valueSatoshis)) - sum(got.map((output) => output.valueSatoshis)), tokens };
};

/** Whether a transaction worked out again gives more of the wallet's, or gets it less, than the one the user was shown. */
const worseForTheWallet = (shown: Pick<Plan, 'inputs' | 'outputs'>, fresh: Pick<Plan, 'inputs' | 'outputs'>): boolean => {
  const before = walletBalance(shown);
  const after = walletBalance(fresh);
  if (after.satoshis > before.satoshis) return true;
  return [...new Set([...before.tokens.keys(), ...after.tokens.keys()])].some((category) => (after.tokens.get(category) ?? 0n) > (before.tokens.get(category) ?? 0n));
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
      /** The issuer's words for a category, as kept on this device (`TokenRegistries.known`). Never waited for. */
      registry?: (category: string) => RegistryToken | undefined;
      /**
       * Look up the registries of the categories an action's review writes that the device knows nothing of yet,
       * ending within a bounded time (`TokenRegistries.lookUpWithin`). A preview is returned when it has ended.
       */
      lookUp?: (categories: string[]) => Promise<void>;
      /**
       * Where the wallet speaks to applications' services (docs/xo-service.md). Without it no service is contacted, and
       * an action that needs another participant is refused.
       */
      service?: ServiceOptions;
    } = {},
  ) {}

  /** Actions worked out with a service and waiting for the user's approval, by the request they answer. */
  private readonly pendingShared = new Map<string, PendingShared>();
  /** Exchanges with a template's service under way, by the template's identifier. */
  private readonly contacting = new Map<string, Promise<ServiceStatus | undefined>>();

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
    const resource = this.resourceOf(definition);
    return {
      identifier: template.identifier,
      contentHash: template.contentHash,
      name: definition.name ?? 'Unnamed template',
      description: definition.description ?? '',
      actions: Object.entries(definition.actions ?? {}).map(([action, { name, description }]) => ({ action, name: name ?? action, description: description ?? '' })),
      trusted: kept !== undefined,
      ...(kept?.cameBack === true ? { cameBack: true } : {}),
      findings: templateFindings(definition),
      ...(resource === undefined ? {} : { service: resource.usable ? { description: resource.description, url: resource.url } : { description: resource.description, problem: resource.reason } }),
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
  async trust(names: TemplateNames, presented: PresentedTexts | undefined, application?: string, options: { contact?: boolean; from?: 'file' } = {}): Promise<KeptTemplate> {
    const kept = await this.trustOnly(names, presented, application, options.from);
    // The user trusts it now, in this session: its service, if it names one, is asked who it is and what is possible.
    // A trust restored from the backup does not ask (docs/xo-service.md, "When a wallet speaks to a service").
    if (options.contact === true) void this.connect(kept.identifier);
    return kept;
  }

  private async trustOnly(names: TemplateNames, presented: PresentedTexts | undefined, application?: string, from?: 'file'): Promise<KeptTemplate> {
    let kept = this.keptTemplate(names);
    if (kept === undefined) {
      const suggestion = this.suggestions.find((suggested) => suggested.identifier === names.identifier && suggested.contentHash === names.contentHash);
      const texts = presented ?? suggestion?.texts;
      if (texts === undefined) return refuse('This wallet does not have that template.');
      // Trust given again after it was withdrawn, or deleted. Where the backup has the withdrawal, the template is
      // stored again under the next number, which the withdrawal does not reach; where it has not, nothing there changed.
      const deleted = suggestion === undefined ? this.deletedOf(names) : undefined;
      const withdrawn = suggestion?.withdrawn ?? (deleted === undefined ? undefined : { renewal: deleted.renewal, stored: deleted.stored || deleted.withdrawnBefore === true });
      const renewal = withdrawn === undefined ? 0 : withdrawn.stored ? withdrawn.renewal + 1 : withdrawn.renewal;
      const read = readPresented(names, texts);
      // The backup's record of the withdrawn trust serves again where the backup was never told of the withdrawal. A
      // deletion the backup was not told of may concern a template it never held: the template is written again.
      const asStored = suggestion?.withdrawn !== undefined && !suggestion.withdrawn.stored;
      kept = {
        identifier: read.identifier,
        contentHash: read.contentHash,
        text: read.text,
        name: read.definition.name ?? 'Unnamed template',
        trustedAt: this.options.now?.() ?? Math.floor(Date.now() / 1000),
        applications: [],
        stored: asStored,
        ...(renewal === 0 ? {} : { renewal }),
        ...(from === undefined ? {} : { from }),
      };
      this.change({
        templates: [...this.state.templates, kept],
        ...(suggestion?.withdrawn === undefined ? {} : { suggested: (this.state.suggested ?? []).filter((suggested) => !(suggested.identifier === names.identifier && suggested.contentHash === names.contentHash)) }),
        ...(deleted === undefined ? {} : { deleted: (this.state.deleted ?? []).filter((known) => known !== deleted) }),
      });
    }
    if (application !== undefined && !kept.applications.includes(application)) kept = this.updateTemplate(kept.identifier, { applications: [...kept.applications, application] });
    return kept;
  }

  /**
   * The NFTs among the wallet's tokens that a request names: what the action is about. `holding`: the token of an
   * invitation the wallet started, which holds it out of the list until the action is done.
   */
  private async named(request: Pick<ApplicationAction, 'about'>, holding?: TokenCoin): Promise<PositionToken[]> {
    const category = request.about?.category;
    if (category === undefined) return [];
    return withHeld(await this.wallet.tokenCoins(), holding).flatMap(({ coin }) => {
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
    const about = await this.named(request, plan.token);
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
    // What its service said is not kept: trusted again, the template shows Connect.
    if (this.state.services !== undefined) this.change({ services: this.state.services.filter((service) => !(service.identifier === kept.identifier && service.contentHash === kept.contentHash)) });
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

  /** Write the withdrawals and deletions the backup does not have yet. @returns how many it still lacks */
  private async tellWithdrawals(): Promise<number> {
    const { archive } = this.options;
    const waiting = (): SuggestedTemplate[] => (this.state.suggested ?? []).filter((suggested) => suggested.withdrawn?.stored === false);
    const deletions = (): DeletedTemplate[] => (this.state.deleted ?? []).filter((deleted) => !deleted.stored);
    if (archive === undefined) return waiting().length + deletions().length;
    for (const deleted of deletions()) {
      const confirmed = await archive.write({ kind: 'template-withdrawal', identifier: deleted.identifier, contentHash: deleted.contentHash, renewal: deleted.renewal, deleted: true }).then(safelyStored, () => false);
      if (confirmed) this.change({ deleted: (this.state.deleted ?? []).map((known) => (known === deleted || (sameNames(known, deleted) && !known.stored) ? { ...known, stored: true } : known)) });
    }
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
    return waiting().length + deletions().length;
  }

  /** The device's mark of a template the user deleted, where there is one. */
  private deletedOf(names: Pick<TemplateNames, 'identifier' | 'contentHash'>): DeletedTemplate | undefined {
    return (this.state.deleted ?? []).find((deleted) => sameNames(deleted, names));
  }

  /**
   * What a template's deletion would leave without its template (`DeletionHolds`): the tokens a record or note ties to
   * it, its positions that are not closed, as the records and the chain say, and the tokens made with it that wait
   * elsewhere. A template the backup holds and this device does not trust is checked with its text, as if it were
   * trusted; nothing is trusted by it.
   */
  async deletionHolds(identifier: string): Promise<DeletionHolds> {
    const kept = this.keptById(identifier);
    const suggested = kept === undefined ? this.suggestions.find((template) => template.identifier === identifier) : undefined;
    const made = (this.state.made ?? []).filter((entry) => entry.templateIdentifier === identifier).map((entry) => entry.category);
    try {
      const held = await this.tokens();
      const tokens = held.filter((token) => token.template?.identifier === identifier);
      const trusting = suggested === undefined ? undefined : readPresented(suggested, suggested.texts);
      const positions = await this.recordedPositions({ template: identifier, ...(trusting === undefined ? {} : { trusting }) });
      return { tokens, open: positions.filter((position) => position.status !== 'closed'), waiting: made.filter((category) => !held.some((token) => token.category === category)) };
    } catch {
      return { tokens: [], open: [], waiting: made, unknown: true };
    }
  }

  /**
   * Delete a template from the wallet, on the user's word: one the user trusts, which is no longer trusted then, or one
   * the user stopped trusting that the backup still holds. What the device kept about it goes: its text, what its
   * service said, the applications allowed to see its tokens, and the token categories made with it. Its tokens stay in
   * the wallet and move in a recovery like any other coin; they are listed as tokens the wallet does not understand.
   * The records of its positions stay, here and in the backup, so that adding the same template again restores what
   * the wallet can do with them.
   *
   * The backup is only ever added to: the template's record stays there. It is marked deleted, by a withdrawal that
   * says so, and no device that reads the backup offers it again. Where no store confirms the mark now, it is written
   * the next time the backup is read; until then, this device alone knows.
   *
   * @param options.confirmed - the user confirmed a deletion that leaves tokens or open positions without their template
   * @throws DeletionNotConfirmedError when something would be left without its template and the user did not confirm
   * @returns whether the backup knows: `true` also when it never held the template
   */
  async deleteTemplate(identifier: string, options: { confirmed?: boolean } = {}): Promise<{ name: string; backupTold: boolean }> {
    if (builtInIdentifiers().has(identifier)) return refuse('This is one of the wallet\'s own templates. It is built in and cannot be deleted.');
    const kept = this.keptById(identifier);
    const suggested = kept === undefined ? this.suggestions.find((template) => template.identifier === identifier) : undefined;
    if (kept === undefined && suggested?.withdrawn === undefined) return refuse('This wallet can delete a template you trust, or one you stopped trusting. It has no such template.');
    if (options.confirmed !== true) {
      const holds = await this.deletionHolds(identifier);
      if (deletionNeedsConfirming(holds)) throw new DeletionNotConfirmedError(holds);
    }
    const names: TemplateNames = kept ?? (suggested as SuggestedTemplate);
    const name = kept?.name ?? (suggested as SuggestedTemplate).name;
    // The number a mark has to reach: the trust's own, or the withdrawal's. A withdrawal that a store confirmed already
    // reaches the backup's record whatever happens to the mark.
    const renewal = kept?.renewal ?? suggested?.withdrawn?.renewal ?? 0;
    const known = this.deletedOf(names);
    const mark: DeletedTemplate = {
      identifier: names.identifier,
      contentHash: names.contentHash,
      renewal: Math.max(renewal, known?.renewal ?? 0),
      stored: false,
      ...(suggested?.withdrawn?.stored === true || known?.stored === true || known?.withdrawnBefore === true ? { withdrawnBefore: true as const } : {}),
    };
    // A trust the backup never held, of a template never withdrawn: nothing there depends on it, and nothing is marked.
    const unknownThere = kept !== undefined && !kept.stored && (kept.renewal ?? 0) === 0 && known === undefined;
    const ours = (entry: { identifier?: string; templateIdentifier?: string }): boolean => (entry.identifier ?? entry.templateIdentifier) === names.identifier;
    this.change({
      templates: this.state.templates.filter((template) => !ours(template)),
      suggested: (this.state.suggested ?? []).filter((template) => !sameNames(template, names)),
      services: (this.state.services ?? []).filter((service) => !ours(service)),
      made: (this.state.made ?? []).filter((entry) => !ours(entry)),
      deleted: [...(this.state.deleted ?? []).filter((deleted) => !sameNames(deleted, names)), ...(unknownThere ? [] : [mark])],
    });
    // Actions worked out with its service and not carried out are put aside.
    for (const [key, pending] of [...this.pendingShared]) {
      if (pending.request.template.identifier !== identifier) continue;
      this.pendingShared.delete(key);
      await this.putAside(pending).catch(() => undefined);
    }
    if (unknownThere) return { name, backupTold: true };
    return { name, backupTold: (await this.tellWithdrawals()) === 0 };
  }

  /**
   * Read a template from a file the user chose, on this device, and check it as an offer of an application's is
   * checked: no larger than an offer may be, a template the XO engine accepts and this wallet can run, with the
   * identifier and the hash of its text worked out here. Nothing is trusted or stored.
   * @throws TemplateFileError with the reason, in plain words
   */
  readTemplateFile(text: string): TemplateFile {
    if (text.trim() === '') throw new TemplateFileError('empty', 'The file is empty.');
    if (text.length > LARGEST_TEMPLATE_FILE) throw new TemplateFileError('too large', TEMPLATE_FILE_TOO_LARGE);
    try {
      JSON.parse(text);
    } catch {
      throw new TemplateFileError('not json', 'This file is not JSON.');
    }
    let read: ReadTemplate;
    try {
      read = readTemplate(text);
    } catch (error) {
      throw new TemplateFileError('not a template', `This is not an XO template: ${shortReason((error as Error).message)}.`);
    }
    const names: TemplateNames = { identifier: read.identifier, contentHash: read.contentHash };
    if (builtInIdentifiers().has(names.identifier)) throw new TemplateFileError('not a template', 'This is one of the wallet\'s own templates. It is built in already.');
    const kept = this.keptById(names.identifier);
    if (kept !== undefined) return { kind: 'trusted', names: { identifier: kept.identifier, contentHash: kept.contentHash }, name: kept.name };
    const texts: PresentedTexts = { template: text };
    let summary: TemplateSummary;
    try {
      summary = this.describe(names, texts);
    } catch (error) {
      throw new TemplateFileError('not a template', error instanceof PresentationError ? `This wallet cannot use this template: ${shortReason(error.message)}.` : `This is not an XO template: ${shortReason((error as Error).message)}.`);
    }
    const suggested = this.suggestions.some((template) => sameNames(template, names) && template.texts.template === text);
    return { kind: suggested ? 'suggested' : 'new', names, texts, summary };
  }

  /**
   * Trust a template the user added from a file, on their word, as a page's offer is trusted: stored in the backup now
   * where a store answers, its service asked who it is and what is possible if it names one, and the position records an
   * earlier owner left for it checked against the chain. No application is told of it.
   */
  async trustFile(file: Extract<TemplateFile, { kind: 'new' | 'suggested' }>): Promise<KeptTemplate> {
    const kept = await this.trust(file.names, file.texts, undefined, { contact: true, from: 'file' });
    await this.storeNow(kept.identifier);
    await this.confirmRecords().catch(() => undefined);
    return this.keptById(kept.identifier) ?? kept;
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
      applicationInputs = applicationCoins.map(({ input, index, utxo, lockingScript, state }) => {
        // A coin is unlocked with the action's values and the values of its script's state the request gave.
        const coinValues = state === undefined ? values : { ...state, ...values };
        const unlocking = templateUnlockingBytecode(definition, lockingScript, input, coinValues);
        return {
          coin: { utxo, template: template.identifier, height: 0 },
          inputIdentifier: input,
          bytes: inputBytes(unlocking),
          kind: 'application' as const,
          unlocking,
          sequence: templateSequenceNumber(definition, input, coinValues) ?? 0,
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
    // Scripts the template says the key holder need not track, scripts no action of the role pays to (the key holder
    // learns of a script from an output it adds in the role), and scripts many coins share, are not followed: those
    // coins are given with their unlocking.
    const crowded = new Set<string>();
    const untracked = new Set(
      applicationCoins
        .filter(({ lockingScript }) => {
          const script = definition.lockingScripts?.[lockingScript] as { relevant?: unknown; roles?: Record<string, { relevant?: unknown }> } | undefined;
          return script?.relevant === false || script?.roles?.[request.role]?.relevant === false || outputsToScriptInRole(definition, lockingScript, request.role).length === 0;
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
      // Tokens of a category made now are made by the transaction itself: nobody pays them.
      if (creates !== undefined && category === String(values[creates])) continue;
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
    // Satoshis of the application's coins that the template leaves out of the change (`omitChangeAmounts`) pay toward
    // the outputs and the fee first, and what is left of them goes to the fee: it is never change for the wallet.
    // Where they pay for everything by themselves, no coin of the wallet's is added, and only what the wallet's own
    // inputs bring comes back to it; where they do not, the wallet's coins pay the rest and get their change, as always.
    let omitted: bigint;
    try {
      omitted = sum(applicationInputs.map(({ inputIdentifier, coin }) => templateOmittedSatoshis(definition, inputIdentifier as string, coin.utxo.output.valueSatoshis, values)));
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      return refuse(error.message);
    }
    const fixedValue = sum(choosing.fixedInputs.map((input) => input.utxo.output.valueSatoshis));
    const paid = sum(paying.map((output) => output.valueSatoshis));
    const plainBytes = transactionBytes(choosing.fixedInputs.map((input) => input.inputBytes), paying);
    let choice: ReturnType<typeof chooseCoins>;
    if (omitted > 0n && omitted >= paid + requiredFee(plainBytes, this.wallet.feeRate)) {
      const walletsOwn = fixedValue - omitted;
      const withBytes = transactionBytes(choosing.fixedInputs.map((input) => input.inputBytes), [...paying, leastLeftOver]);
      const short = paid + requiredFee(withBytes, this.wallet.feeRate) - omitted;
      const back = walletsOwn - (short > 0n ? short : 0n);
      if (back >= smallest) choice = { coins: [], changeSatoshis: back, feeSatoshis: fixedValue - paid - back, remainderSatoshis: 0n, bytes: withBytes };
      else if (mustLeave) return refuse('The template leaves an output to the wallet, and the coins whose satoshis go to the fee leave nothing that the wallet may put there.');
      else choice = { coins: [], feeSatoshis: fixedValue - paid, remainderSatoshis: walletsOwn, bytes: plainBytes };
    } else {
      choice = chooseCoins({ ...choosing, outputs: paying });
    }
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
    const beyondOutputs = omitted - paid;
    const fromApplication = beyondOutputs <= 0n ? 0n : beyondOutputs < choice.feeSatoshis ? beyondOutputs : choice.feeSatoshis;
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
    const paidFromWallet = new Set(tokenInputs.map(({ coin }) => hex(coin.utxo.output.token?.category ?? new Uint8Array())));
    const tokensLeaving = leavingTokens(definition, planned, spentToken === undefined ? undefined : token, creates === undefined ? undefined : String(values[creates]), frame.givenCategories.filter((given) => paidFromWallet.has(given)));

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
      ...(fromApplication > 0n ? { feeFromApplicationSatoshis: fromApplication } : {}),
      ...(token === undefined ? {} : { token }),
      ...(payItself === undefined ? {} : { payItself }),
      ...(tokensLeaving.length === 0 ? {} : { tokensLeaving }),
      ...(frame.record === undefined ? {} : { record: frame.record }),
      ...(creates === undefined ? {} : { made: String(values[creates]) }),
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
   *   or pays into, as the wallet lists it from the chain: open before closed before not confirmed, and of several
 *   that stand alike the one recorded last, which is where the wallet last moved the position. An action the user
 *   asks for from the wallet's own list names the script of the entry it was asked on.
   * - **Each value the role provides,** from the first that applies: (1) the record, for the values of the
   *   position's own script; (2) the wallet itself: a token category the action creates where the request gives no
   *   value for it (a value it gives is a category that exists, and the wallet pays its tokens), the category of the token
   *   the action is about where an output names the variable as its token's category and no input does, a locking
   *   script the request does not supply (of the kind the request names, a plain receipt where it names none), and
   *   the category of the template's input for the token from the token itself; (3) the request; (4) the record's
   *   other values, in an action that spends the position; (5) the user, for a value a person can type, when the
   *   wallet acts by itself. A variable nothing fills stops the action, named.
   * - **The application's coins:** each that the request names by outpoint, read from the chain and matched to a
   *   script of the template by its bytecode, made with the action's values and the values the request gives for the
   *   script's state that the role does not provide; and the position's coins at the record's script, for the input whose
   *   unlocking that script names. The wallet looks for no other coin of the application's.
   *
   * With `shared`, another participant joins the action and brings the application's coins: only the wallet's own
   * share is worked out here. A position the request names by a category the wallet made with the template and holds
   * no token of is taken as that category's value, for an action that does not spend the token.
   */
  private async frame(request: ApplicationAction, template: ReadTemplate, shared?: { made: Set<string> }): Promise<Frame> {
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
      if (token === undefined && !(shared?.made.has(category) === true && !spends)) return refuse('This wallet holds no such token.');
      if (held.length > 1) return refuse('This wallet holds more than one coin with that token; it does not choose between them.');
      if (spends && token?.place === 'earlier') return refuse('The token is at an address of an earlier seed, where that seed could still spend it. It is swept first.');
      if (spends && token?.place === 'vault') return refuse('The token is at a vault address. It is moved to an ordinary address of the wallet first.');
    }

    // The position's record: one at a script the action spends, continues or pays into.
    const touches = (lockingScript: string): boolean => spendingInputs(definition, shape, lockingScript).length > 0 || paysTo(definition, shape, lockingScript);
    let record: PositionRecordEntry | undefined;
    if (category !== undefined) {
      const rank: Record<RecordedStatus, number> = { open: 0, closed: 1, unconfirmed: 2, held: 3 };
      const listed = (await this.recordedPositions({ template: template.identifier, categories: new Set([category]), trusting: template }))
        .filter(({ record: entry }) => entry.lockingScriptIdentifier !== undefined && entry.roleIdentifier === request.role && touches(entry.lockingScriptIdentifier))
        .filter(({ lockingBytecode }) => request.fromWallet?.script === undefined || lockingBytecode === request.fromWallet.script);
      const best = Math.min(...listed.map(({ status }) => rank[status]));
      record = listed.filter(({ status }) => rank[status] === best).at(-1)?.record;
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
    // A category made now is the identifier of the wallet's coin at input 0, which no request can choose. A value the
    // request gives for such a variable is therefore a category that exists: the action uses it as given, and the
    // wallet pays tokens of it from its own coins, as a contract that mints from its own coin carries its category on.
    for (const variable of shape.creating) {
      if (request.creates === variable && supplied(variable) !== undefined) return refuse(`The request gives a value for ${nameOf(variable)} and says that the action makes a new token category there. A new category cannot be given.`);
    }
    // Where the request says which token the action is about, that token's category is the value of a variable an
    // output names as its token's category and no input does, unless the request says the action makes it now.
    const aboutCategory = (variable: string): boolean => category !== undefined && supplied(variable) === undefined && request.creates !== variable && shape.creating.includes(variable);
    const creating = shape.creating.filter((variable) => !aboutCategory(variable) && supplied(variable) === undefined);
    // The existing categories the request gives in this way: tokens of them that the wallet pays leave the wallet.
    const givenCategories = shape.creating.flatMap((variable) => (supplied(variable) === undefined ? [] : [String(supplied(variable)).toLowerCase()]));
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
      for (const { input, inputIndex } of shared === undefined ? applicationInputs(definition, shape) : []) {
        if ((definition.inputs?.[input] as { unlockingScript?: string } | undefined)?.unlockingScript === undefined) {
          return refuse(`The template does not say how its input ${inputName(input)} is unlocked, and it is not the wallet's token.`);
        }
        const at = inputIndex === undefined ? {} : { index: inputIndex };
        const outpoint = named[input];
        if (outpoint !== undefined) {
          const { utxo, lockingScript, state } = await this.namedCoin(definition, input, outpoint, values, request);
          if (applicationCoins.some((coin) => outpointOf(coin.utxo) === outpointOf(utxo))) return refuse(`The coin for ${inputName(input)} is already spent as another input of the action.`);
          applicationCoins.push({ input, ...at, utxo, lockingScript, ...(state === undefined ? {} : { state }) });
          followed(lockingScript, state === undefined ? values : { ...state, ...values }, utxo.output.lockingBytecode);
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
      givenCategories,
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
   *
   * A script's state can hold values that the role does not provide, which the XO engine takes from the coin it
   * follows. For those, and only those, the values the request gives are used too (`state`): the variables the template
   * lists in the script's state, for the script and for the role. Nothing is taken on trust: the coin's bytecode has
   * to be the script made with them.
   */
  private async namedCoin(definition: ReadTemplate['definition'], input: string, outpoint: string, values: TemplateValues, request: Pick<ApplicationAction, 'role' | 'variables'>): Promise<{ utxo: Utxo; lockingScript: string; state?: TemplateValues }> {
    const name = definition.inputs?.[input]?.name ?? input;
    const [transactionId = '', index = ''] = outpoint.split(':');
    if (!/^[0-9a-f]{64}$/.test(transactionId) || !/^\d{1,5}$/.test(index)) return refuse(`The request names the coin for "${name}" in a form this wallet does not read.`);
    const output = await this.namedOutput(outpoint);
    if (output === undefined) return refuse(`The coin the request names for "${name}" is not on chain.`);
    const stateOf = (candidate: string): TemplateValues | undefined => {
      const given = Object.fromEntries(stateVariables(definition, candidate, request.role).flatMap((name) => (values[name] === undefined && request.variables[name] !== undefined ? [[name, request.variables[name]]] : [])));
      if (Object.keys(given).length === 0) return undefined;
      try {
        return typedValues(definition, given);
      } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        return undefined;
      }
    };
    const lockingScript = coinScriptOf(definition, input, output.lockingBytecode, (candidate) => ({ ...stateOf(candidate), ...values }));
    if (lockingScript === undefined) return refuse(`The coin the request names for "${name}" is at no script of the template "${definition.name ?? ''}", made with the values of this action. It is refused.`);
    const unspent = (await this.wallet.chain.listUnspent(output.lockingBytecode)).some((listed) => listed.transactionId === transactionId && listed.index === Number(index));
    if (!unspent) return refuse(`The coin the request names for "${name}" is spent.`);
    const state = stateOf(lockingScript);
    return { utxo: { transactionHash: hexToBin(transactionId), index: Number(index), output }, lockingScript, ...(state === undefined ? {} : { state }) };
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
    const preview = await this.reviewed(request);
    // The registries of the categories the review will write, those the wallet does not know yet, are looked up
    // first, for a bounded time: a lookup that fails or is slow leaves them in raw units and never fails the review.
    await this.options.lookUp?.(previewCategories(preview)).catch(() => undefined);
    return preview;
  }

  /**
   * The review of an action. One that another participant joins through the template's service is worked out with the
   * service now: the invitation the service joined waits, checked, for the user's approval (`carryOut`), or until it is
   * put aside (`discardPreview`).
   */
  private async reviewed(request: ApplicationAction): Promise<ActionPreview> {
    this.wallet.requireUsable();
    const { template } = this.templateOf(request);
    const route = this.serviceRoute(request, template);
    if (route === undefined) return this.worked(request);
    await this.discardPreview(request);
    const pending = await this.sharedRound(request, template, route);
    try {
      const preview = await this.worked(pending.request, pending);
      this.pendingShared.set(requestKey(request), pending);
      return preview;
    } catch (error) {
      await this.putAside(pending);
      throw error;
    }
  }

  private async worked(request: ApplicationAction, shared?: PendingShared): Promise<ActionPreview> {
    this.wallet.requireUsable();
    const { template, kept } = this.templateOf(request);
    const summary = this.summary(template, kept);
    const plan = shared?.plan ?? (await this.plan(request));
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
    // An NFT of the application's coins is carried on where an output holds it unchanged, or changed as its
    // capability allows: a contract that keeps its state in a mutable or minting NFT changes the commitment.
    // A token on a data output is matched too: it is shown above, as destroyed there.
    const carried = plan.outputs.flatMap(({ output }) => (output.token === undefined ? [] : [tokenMoved(output.token)]));
    const nftInputs = plan.inputs.flatMap((input) => (input.coin.utxo.output.token?.nft === undefined ? [] : [{ ...tokenMoved(input.coin.utxo.output.token), input }]));
    for (const { input } of matchNfts(nftInputs, carried).notCarriedOn) {
      const nft = input.coin.utxo.output.token as NonNullable<Output['token']>;
      if (input.kind === 'application') destroyed.push({ name: definition.inputs?.[input.inputIdentifier ?? '']?.name ?? input.inputIdentifier ?? 'Input', token: tokenMoved({ ...nft, amount: 0n }), how: 'not carried on', wallet: false });
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
          return value === undefined ? [] : [{ name: described?.name ?? variable, description: described?.description ?? '', value: String(value), ...(typeof described?.type === 'string' ? { type: described.type } : {}) }];
        }),
      },
      figures: {
        givesSatoshis: gives,
        getsSatoshis: gets,
        feeSatoshis: plan.feeSatoshis,
        remainderSatoshis: plan.remainderSatoshis,
        ...(plan.feeFromApplicationSatoshis === undefined ? {} : { feeFromApplicationSatoshis: plan.feeFromApplicationSatoshis }),
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
      ...(shared === undefined ? {} : { service: this.servicePart(definition, shared) }),
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
    const what = builtDifference(plan, transaction);
    if (what !== undefined) throw new Error(`The transaction that was built differs from the one the wallet worked out and showed: ${what}. Nothing was sent.`);
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
    const route = this.serviceRoute(request, this.templateOf(request).template);
    if (route !== undefined) return this.carryOutShared(request, route, onStage, consent);
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
        outputs: plan.outputs.map(({ output, identifier: outputIdentifier, wallet }) => (outputIdentifier === undefined || wallet === 'left over' ? output : { outputIdentifier, lockingBytecode: output.lockingBytecode })),
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
    } catch (error) {
      // The key holder has put the refused transaction aside, so that the coins it named are free again.
      if (error instanceof Error && inputsSpentRefusal(error.message)) throw new InputsSpentError(error.message);
      throw error;
    } finally {
      // Whether or not the network took it, a signature that names these addresses has left the wallet.
      this.wallet.keep(plan.used);
      this.wallet.giveBack(plan.reserved.filter((entry) => !plan.used.includes(entry)));
    }
    onStage('sent');
    return this.afterSending(plan, prepared, kept, plan.made);
  }

  /**
   * What follows an action that was sent, whoever joined it: the next action waits for the key holder to list what this
   * one left the wallet; a category it made is kept for the template's service; and the service, where the template
   * names one, is asked again what is possible (the user has just carried out an action).
   */
  private async afterSending(plan: Plan, prepared: PreparedTransaction, kept: KeptTemplate, made: string | undefined): Promise<ActionOutcome> {
    // The next action waits for the key holder to list what this one left the wallet (`awaitOwnOutputs`).
    this.awaiting = { transactionId: prepared.transactionId, outpoints: plan.outputs.flatMap(({ wallet }, index) => (wallet === undefined ? [] : [`${prepared.transactionId}:${index}`])), since: Date.now() };
    if (await this.ownOutputsListed(this.awaiting)) this.awaiting = undefined;
    const resource = this.resourceOf(readTemplate(kept.text).definition);
    if (made !== undefined && resource !== undefined) {
      this.change({ made: [...(this.state.made ?? []), { templateIdentifier: kept.identifier, category: made, transactionId: prepared.transactionId, madeAt: this.nowSeconds() }] });
    }
    // The action was sent: nothing the service says now, or fails to say, changes that.
    if (resource?.usable === true) await this.connect(kept.identifier, { afterAction: true }).catch(() => undefined);
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
   * Before an action is worked out, and before the wallet's tokens and positions are listed, wait until the key holder
   * lists what the action sent just before left the wallet: its change, and the tokens it gave the wallet. The key holder spends only coins it lists, and it learns of them
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

  // ------------------------------------------------------------------ an application's service

  private nowSeconds(): number {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }

  private callOptions(): ServiceCallOptions {
    const { service } = this.options;
    return { network: service?.network ?? '', ...(service?.fetch === undefined ? {} : { fetch: service.fetch }) };
  }

  /**
   * The service a template names for the wallet's network (docs/xo-service.md, "How a template names its service"), or
   * why it cannot be used; `undefined` where it names none.
   */
  private resourceOf(definition: ReadTemplate['definition']): { usable: true; url: string; description: string } | { usable: false; description: string; reason: string } | undefined {
    const { service } = this.options;
    const found: ServiceResource | undefined = findServiceResource(definition, { network: service?.network ?? '', kind: service?.kind ?? 'public' });
    if (found === undefined) return undefined;
    const description = found.usable ? found.description : ((definition as { resources?: { name: string; description?: string }[] }).resources ?? []).find((resource) => resource.name === found.name)?.description ?? '';
    if (!found.usable) return { usable: false, description, reason: found.reason };
    if (service === undefined) return { usable: false, description, reason: 'This wallet speaks to no service here.' };
    return { usable: true, url: found.url, description };
  }

  /** What the wallet keeps about a template's service, where it was for the address the template names now. */
  private keptService(names: Pick<TemplateNames, 'identifier' | 'contentHash'>, url?: string): KeptService | undefined {
    return (this.state.services ?? []).find((service) => service.identifier === names.identifier && service.contentHash === names.contentHash && (url === undefined || service.url === url));
  }

  private updateService(names: Pick<TemplateNames, 'identifier' | 'contentHash'>, base: Pick<KeptService, 'url' | 'description' | 'walletRole'>, change: { [Key in keyof KeptService]?: KeptService[Key] | undefined }): void {
    const services = this.state.services ?? [];
    const same = (service: KeptService): boolean => service.identifier === names.identifier && service.contentHash === names.contentHash;
    const known = services.find(same);
    const fresh = known === undefined || known.url !== base.url || known.walletRole !== base.walletRole;
    const next: KeptService = { ...(fresh ? { identifier: names.identifier, contentHash: names.contentHash } : known), ...base, ...change } as KeptService;
    if ('failure' in change && change.failure === undefined) delete next.failure;
    this.change({ services: [...services.filter((service) => !same(service)), next] });
  }

  /** Note an exchange that gave no usable answer, and give the error the wallet throws for it. */
  private serviceFailed(names: Pick<TemplateNames, 'identifier' | 'contentHash'>, base: Pick<KeptService, 'url' | 'description' | 'walletRole'>, failure: ServiceCallFailure): Error {
    this.updateService(names, base, { failure: { at: this.nowSeconds(), kind: failure.kind, message: failure.message, ...(failure.code === undefined ? {} : { code: failure.code }) } });
    if (failure.kind !== 'declined') return new ServiceUnreachableError(failure.message, failure.kind);
    return failure.code === 'inputs-spent' ? new InputsSpentError(failure.message) : new ServiceDeclinedError(failure.message, failure.code);
  }

  /**
   * The role the service takes in the template, from its hello answer: the one kept, unless `fresh`.
   * @throws ServiceUnreachableError, ServiceDeclinedError
   */
  private async serviceRoleFor(names: Pick<TemplateNames, 'identifier' | 'contentHash'>, base: Pick<KeptService, 'url' | 'description' | 'walletRole'>, fresh: boolean): Promise<string> {
    const known = this.keptService(names, base.url);
    if (!fresh && known?.walletRole === base.walletRole && known.role !== undefined) return known.role;
    const answer = await askServiceHello(base.url, { template: { identifier: names.identifier, contentHash: names.contentHash }, role: base.walletRole }, this.callOptions());
    if (!answer.ok) throw this.serviceFailed(names, base, answer);
    const role = servedRole(answer.serves, { identifier: names.identifier, contentHash: names.contentHash }, base.walletRole);
    if (role === undefined) throw this.serviceFailed(names, base, { ok: false, kind: 'declined', message: 'The service does not serve this template.' });
    this.updateService(names, base, { role, reachedAt: this.nowSeconds(), failure: undefined });
    return role;
  }

  /**
   * The NFTs the wallet holds under a template (those its records tie to it, and those of categories it made with it),
   * and the categories it made with it and does not hold: what a service is told, and nothing else. A made category
   * the wallet now holds a token of is no longer kept as made.
   */
  private async heldUnder(identifier: string): Promise<{ tokens: { category: string; commitment: string; capability: 'none' | 'mutable' | 'minting'; outpoint: string }[]; made: MadeCategory[] }> {
    const made = (this.state.made ?? []).filter((entry) => entry.templateIdentifier === identifier);
    const categories = new Set([...this.positionRecords, ...this.suggestedRecords].flatMap((entry) => (entry.templateIdentifier === identifier && entry.token !== undefined ? [entry.token.category] : [])));
    for (const entry of made) categories.add(entry.category);
    const tokens = (await this.wallet.tokenCoins()).flatMap(({ coin }) => {
      const token = tokenOf(coin);
      return token === undefined || !categories.has(hex(token.category)) ? [] : [{ category: hex(token.category), commitment: hex(token.commitment), capability: token.capability, outpoint: outpointOf(coin.utxo) }];
    });
    const held = new Set(tokens.map((token) => token.category));
    if (made.some((entry) => held.has(entry.category))) this.change({ made: (this.state.made ?? []).filter((entry) => !(entry.templateIdentifier === identifier && held.has(entry.category))) });
    return { tokens, made: made.filter((entry) => !held.has(entry.category)) };
  }

  /**
   * Ask the service what is possible now, with the wallet's tokens under the template, and keep the answer.
   * @throws ServiceUnreachableError, ServiceDeclinedError
   */
  private async possibleFor(names: Pick<TemplateNames, 'identifier' | 'contentHash'>, base: Pick<KeptService, 'url' | 'description' | 'walletRole'>): Promise<NonNullable<KeptService['possible']>> {
    // Right after an action, what it gave the wallet is told as held, not as made: the key holder lists it first.
    await this.awaitOwnOutputs();
    const { tokens, made } = await this.heldUnder(names.identifier);
    const limit = SERVICE_LIMITS.entries;
    const answer = await askServicePossible(
      base.url,
      { template: { identifier: names.identifier, contentHash: names.contentHash }, role: base.walletRole, tokens: tokens.slice(0, limit), made: made.slice(-limit).map(({ category, transactionId }) => ({ category, transactionId })) },
      this.callOptions(),
    );
    if (!answer.ok) throw this.serviceFailed(names, base, answer);
    const possible = { at: this.nowSeconds(), height: answer.height, start: answer.start, items: answer.items };
    this.updateService(names, base, { possible, reachedAt: possible.at, failure: undefined });
    return possible;
  }

  /**
   * Speak to a template's service, when the user presses Connect: its hello, then what is possible for the wallet's
   * tokens under the template. Also done when the user trusts the template in this session (`trust` with `contact`) and
   * after an action of the template. Never otherwise: nothing here runs in the background or on start-up. A failure
   * leaves the template trusted and the service noted as not reached, in plain words (`serviceOf`).
   * @returns the service as the screens show it, or `undefined` for a template that is not trusted
   */
  async connect(identifier: string, options: { afterAction?: boolean } = {}): Promise<ServiceStatus | undefined> {
    const running = this.contacting.get(identifier);
    if (running !== undefined) return running;
    const contact = this.contact(identifier, options).finally(() => this.contacting.delete(identifier));
    this.contacting.set(identifier, contact);
    return contact;
  }

  /** The exchange with a template's service under way, if one is: for a screen that shows it, and for tests. */
  serviceContact(identifier: string): Promise<ServiceStatus | undefined> | undefined {
    return this.contacting.get(identifier);
  }

  private async contact(identifier: string, options: { afterAction?: boolean }): Promise<ServiceStatus | undefined> {
    const kept = this.keptById(identifier);
    if (kept === undefined) return undefined;
    const { definition } = readTemplate(kept.text);
    const resource = this.resourceOf(definition);
    const walletRole = this.keptService(kept)?.walletRole ?? walletRoleOf(definition);
    if (resource?.usable !== true || walletRole === undefined) return this.serviceOf(identifier);
    const base = { url: resource.url, description: resource.description, walletRole };
    try {
      await this.serviceRoleFor(kept, base, options.afterAction !== true);
      await this.possibleFor(kept, base);
    } catch (error) {
      // Noted in what the wallet keeps about the service; the template stays trusted.
      if (!(error instanceof ActionRefusedError || error instanceof InputsSpentError)) throw error;
    }
    return this.serviceOf(identifier);
  }

  /** A trusted template's service, as the screens show it: `undefined` where the template names none for this network. */
  serviceOf(identifier: string): ServiceStatus | undefined {
    const kept = this.keptById(identifier);
    if (kept === undefined) return undefined;
    const { definition } = readTemplate(kept.text);
    const resource = this.resourceOf(definition);
    if (resource === undefined) return undefined;
    if (!resource.usable) return { description: resource.description, state: 'not usable', problem: resource.reason };
    const roleName = (role: string): { role: string; name: string } => ({ role, name: definition.roles?.[role]?.name ?? role });
    const service = this.keptService(kept, resource.url);
    const walletRole = service?.walletRole ?? walletRoleOf(definition);
    const state = service?.failure !== undefined ? 'not reached' : service?.reachedAt !== undefined ? 'reached' : 'never asked';
    return {
      description: resource.description,
      url: resource.url,
      state,
      ...(walletRole === undefined ? {} : { walletRole: roleName(walletRole) }),
      ...(service?.role === undefined ? {} : { role: roleName(service.role) }),
      ...(service?.reachedAt === undefined ? {} : { reachedAt: service.reachedAt }),
      ...(service?.possible === undefined ? {} : { checkedAt: service.possible.at }),
      ...(service?.failure === undefined ? {} : { failure: service.failure }),
    };
  }

  /**
   * An action as the wallet offers it, in the template's words: what a person is asked to type, and, where the action
   * needs what only the application gives, why it is not offered by the wallet alone.
   */
  private offerOf(definition: ReadTemplate['definition'], action: string, role: string, options: { service?: ServiceOffer; alone?: boolean }): TokenAction | undefined {
    const shape = actionShape(definition, action, role);
    if (typeof shape === 'string') return undefined;
    const described = (variable: string) => ({ variable, name: definition.variables?.[variable]?.name ?? variable, description: definition.variables?.[variable]?.description ?? '', type: String(variableType(definition, variable) ?? 'bytes') });
    const { asks, missing } = askedValues(definition, shape);
    const reasons = [
      ...(options.alone === true ? applicationInputs(definition, shape).map(({ input }) => `It spends a coin of the application's, "${definition.inputs?.[input]?.name ?? input}", which only the application can name.`) : []),
      ...(missing.length === 0 ? [] : [`It needs ${missing.map((variable) => `"${described(variable).name}"`).join(', ')}, which only the application gives.`]),
    ];
    const words = definition.actions?.[action];
    return {
      action,
      role,
      name: words?.name ?? action,
      description: words?.description ?? '',
      ...(asks.length === 0 ? {} : { asks: asks.map(described) }),
      ...(reasons.length === 0 ? {} : { needsApplication: reasons.join(' ') }),
      ...(options.service === undefined ? {} : { service: options.service }),
    };
  }

  /** The follow-up actions the template's service last said a token of a category offers, each one the template allows. */
  private serviceActions(kept: KeptTemplate, category: string, categories: Set<string>): (TokenAction & { item: ServiceItem; place: string })[] {
    const { definition } = readTemplate(kept.text);
    const resource = this.resourceOf(definition);
    const service = resource?.usable === true ? this.keptService(kept, resource.url) : undefined;
    const possible = service?.possible;
    if (service === undefined || possible === undefined) return [];
    const offered: (TokenAction & { item: ServiceItem; place: string })[] = [];
    for (const item of possible.items) {
      if (item.category !== category || offered.some((known) => known.action === item.action)) continue;
      const checked = checkServiceItem(definition, service.walletRole, item, categories);
      if (!checked.ok) continue;
      const says = (item.says ?? []).map(({ variable, value }) => saidValue(definition, variable, value));
      const offer = this.offerOf(definition, item.action, service.walletRole, { service: { checkedAt: possible.at, ...(says.length === 0 ? {} : { says }) } });
      if (offer !== undefined) offered.push({ ...offer, item, place: checked.place });
    }
    return offered;
  }

  /**
   * What a template the user trusts offers from the wallet itself (decision of 22 November 2026: every action is visible
   * once the template is trusted): its starting actions for the wallet's role, or, where no role is settled, every
   * starting action under the role its entry names, each with what its service last said of it (never asked: offered,
   * and checked when the user acts); and the actions its service offers on tokens the wallet made with it and does not
   * hold, such as one that waits in the application's contract, under the template's name for where it waits. Nothing is
   * asked of the service here.
   */
  async templateActions(identifier: string): Promise<TemplateActions | undefined> {
    const kept = this.keptById(identifier);
    if (kept === undefined) return undefined;
    const { definition } = readTemplate(kept.text);
    const service = this.serviceOf(identifier);
    const resource = this.resourceOf(definition);
    const keptService = resource?.usable === true ? this.keptService(kept, resource.url) : undefined;
    const settled = keptService?.walletRole ?? walletRoleOf(definition);
    const template = { identifier, name: kept.name };
    const entries = this.startEntries(definition, settled);
    if (settled === undefined && entries.length === 0) return { template, ...(service === undefined ? {} : { service }), starting: [], waiting: [] };
    const possible = keptService?.possible;
    const starting = entries.flatMap(({ action, role }): TemplateAction[] => {
      const needsService = otherParticipants(definition, action, role).length > 0;
      if (!needsService) return [this.offerOf(definition, action, role, { alone: true })].filter((offer): offer is TokenAction => offer !== undefined);
      const said = possible?.start.find((entry) => entry.action === action);
      const offer = this.offerOf(definition, action, role, {
        service: { ...(said === undefined ? {} : { available: said.available, ...(said.reason === undefined ? {} : { reason: said.reason }) }), ...(possible === undefined ? {} : { checkedAt: possible.at }) },
      });
      if (offer === undefined) return [];
      return [resource?.usable === true ? offer : { ...offer, needsApplication: `It needs the template's service, which this wallet cannot use here${resource === undefined ? '' : `: ${resource.reason}`}` }];
    });
    const { made } = await this.heldUnder(identifier);
    const categories = new Set(made.map((entry) => entry.category));
    const waiting = made.flatMap((entry) => this.serviceActions(kept, entry.category, categories).map(({ item, place, ...offer }): TemplateAction => ({ ...offer, waiting: { category: item.category, at: place } })));
    const roles = [...new Set(starting.map(({ role }) => role))];
    const roleNames = roles.length > 1 ? { roleNames: Object.fromEntries(roles.map((role) => [role, definition.roles?.[role]?.name ?? role])) } : {};
    return { template, ...(settled === undefined ? {} : { role: settled }), ...roleNames, ...(service === undefined ? {} : { service }), starting, waiting };
  }

  /**
   * The starting actions the wallet offers, each with its role: those of the settled role where there is one; else every
   * starting action of the template, under the role its entry names (the user picks the action, and the role with it).
   */
  private startEntries(definition: ReadTemplate['definition'], settled: string | undefined): { action: string; role: string }[] {
    return settled === undefined ? startEntriesOf(definition) : startingActionsOf(definition, settled).map((action) => ({ action, role: settled }));
  }

  /**
   * A starting action of a trusted template, as the user asks for it from the wallet itself, with what they typed, under
   * the role the offer named (`TemplateActions.starting`). The role may be left out where the action is offered under one
   * role only.
   */
  startAction(identifier: string, action: string, typed: Record<string, string | number> = {}, role?: string): ApplicationAction {
    const kept = this.keptById(identifier);
    if (kept === undefined) return refuse('This wallet does not trust that template.');
    const { definition } = readTemplate(kept.text);
    const entries = this.startEntries(definition, this.keptService(kept)?.walletRole ?? walletRoleOf(definition));
    const under = entries.filter((entry) => entry.action === action && (role === undefined || entry.role === role)).map((entry) => entry.role);
    const [only] = under;
    if (only === undefined) return refuse(`The template "${kept.name}" offers no starting action "${action}" to the wallet${role === undefined ? '' : ` as "${definition.roles?.[role]?.name ?? role}"`}.`);
    if (under.length > 1) return refuse(`The template "${kept.name}" offers "${definition.actions?.[action]?.name ?? action}" as ${under.map((each) => `"${definition.roles?.[each]?.name ?? each}"`).join(' and ')}: the request has to say which.`);
    return { template: { identifier: kept.identifier, contentHash: kept.contentHash }, action, role: only, variables: {}, fromWallet: { typed } };
  }

  /** An action on a token the wallet made with a template and does not hold (`TemplateActions.waiting`), with what the user typed. */
  waitingAction(identifier: string, category: string, action: string, typed: Record<string, string | number> = {}): ApplicationAction {
    const kept = this.keptById(identifier);
    if (kept === undefined) return refuse('This wallet does not trust that template.');
    const service = this.keptService(kept);
    const item = service?.possible?.items.find((candidate) => candidate.category === category && candidate.action === action);
    if (service === undefined || item === undefined) return refuse('Its service does not offer that action for this token now.');
    return { template: { identifier: kept.identifier, contentHash: kept.contentHash }, action, role: service.walletRole, variables: {}, about: { category, spent: item.about?.spent ?? false }, fromWallet: { typed } };
  }

  /**
   * Whether an action is carried out with the template's service, and where (decision E of 22 November 2026): an action
   * whose template requires a participant in a role other than the request's goes through the service the template
   * names; one that requires no other participant is carried out by the wallet alone, from the request, as always.
   * @throws ActionRefusedError for an action that needs another participant where no usable service is named
   */
  private serviceRoute(request: ApplicationAction, template: ReadTemplate): { url: string; description: string } | undefined {
    const { definition } = template;
    const others = otherParticipants(definition, request.action, request.role);
    if (others.length === 0) return undefined;
    const action = `"${definition.actions?.[request.action]?.name ?? request.action}"`;
    const roles = others.map((role) => `"${definition.roles?.[role]?.name ?? role}"`).join(' and ');
    if (others.length > 1) return refuse(`${action} needs ${roles} to take part; this wallet carries out an action with one service at most. Nothing was signed.`);
    const resource = this.resourceOf(definition);
    if (resource?.usable !== true) return refuse(`${action} needs ${roles} to take part, and the template names no service this wallet can use${resource === undefined ? '' : `: ${resource.reason}`}. Nothing was signed.`);
    if (Object.keys(request.inputs ?? {}).length > 0) return refuse(`In ${action} the service brings the application's coins: a request names none. Nothing was signed.`);
    return { url: resource.url, description: resource.description };
  }

  /**
   * One round with the service for an action it joins (docs/xo-service.md): what is possible for this token, asked
   * afresh, and the service's item for it; the wallet's own share, worked out as for an action it carries out alone;
   * the invitation started with it and sent; what the service added, taken back and checked; and the whole action
   * worked out to the satoshi by the same rules, with the service's coins as the application's. On any refusal or
   * failure the invitation is put aside. Nothing is signed.
   */
  private async sharedRound(request: ApplicationAction, template: ReadTemplate, route: { url: string; description: string }, definingCoin?: AccountCoin): Promise<PendingShared> {
    const { definition } = template;
    const names = { identifier: template.identifier, contentHash: template.contentHash };
    const actionName = `"${definition.actions?.[request.action]?.name ?? request.action}"`;
    this.judge(template, request);
    await this.awaitOwnOutputs();
    const base = { url: route.url, description: route.description, walletRole: request.role };
    const role = await this.serviceRoleFor(names, base, false);
    if (!otherParticipants(definition, request.action, request.role).includes(role)) return refuse(`The service takes the role "${role}", which ${actionName} does not need. Nothing was signed.`);
    const possible = await this.possibleFor(names, base);
    const made = new Set((this.state.made ?? []).filter((entry) => entry.templateIdentifier === template.identifier).map((entry) => entry.category));
    let item: ServiceItem | undefined;
    let asked = request;
    if (request.about === undefined) {
      const said = possible.start.find((entry) => entry.action === request.action);
      if (said?.available === false) throw new ServiceDeclinedError(SERVICE_WORDS.declined(said.reason ?? 'not now.'));
    } else {
      const { category } = request.about;
      const categories = new Set([...made, ...(await this.wallet.tokenCoins()).flatMap(({ coin }) => (tokenOf(coin) === undefined ? [] : [hex(tokenOf(coin)?.category as Uint8Array)]))]);
      item = possible.items.find((candidate) => candidate.action === request.action && candidate.category === category && checkServiceItem(definition, request.role, candidate, categories).ok);
      if (item === undefined) return refuse(`Its service does not offer ${actionName} for this token now.`);
      const bindings = request.bindings ?? item.bindings;
      asked = { ...request, about: item.about ?? request.about, ...(bindings === undefined ? {} : { bindings }) };
    }

    // The wallet's own share, by the rules of an action it carries out alone; the coins of its first commit.
    const frame = await this.frame(asked, template, { made });
    const shape = actionShape(definition, asked.action, asked.role);
    if (typeof shape === 'string') return refuse(shape);
    let defining = definingCoin;
    if (frame.creates !== undefined) defining ??= (await this.wallet.ownCoins()).filter((coin) => coin.utxo.index === 0).sort((a, b) => (a.utxo.output.valueSatoshis > b.utxo.output.valueSatoshis ? -1 : 1))[0];
    const virtual = frame.creates !== undefined && defining === undefined;
    const token = frame.spends ? frame.token : undefined;
    const places = firstCommitPlaces(shape, { defining: frame.creates !== undefined && defining !== undefined, token: token !== undefined });
    const committed = [
      ...(frame.creates === undefined || defining === undefined ? [] : [{ coin: defining, place: places.defining }]),
      ...(token === undefined ? [] : [{ coin: token.coin, place: places.token, ...(frame.tokenInput === undefined ? {} : { inputIdentifier: frame.tokenInput.input }) }]),
    ];
    const values: TemplateValues = { ...frame.values, ...(frame.creates === undefined ? {} : { [frame.creates]: defining === undefined ? PLACEHOLDER_CATEGORY : hex(defining.utxo.transactionHash) }) };
    const identifier = await this.wallet.backend.importTemplate(template.text);
    if (identifier !== template.identifier) throw new Error('The key holder gives the template another identifier than the one it was trusted under.');
    const started = await this.wallet.backend.startShared({
      template: identifier,
      action: asked.action,
      role: asked.role,
      variables: values,
      inputs: committed.map(({ coin, place, ...rest }) => ({ coin, ...rest, ...(place === undefined ? {} : { place }) })),
    });
    const sentAt = Date.now();
    try {
      const joined = await askServiceJoin(route.url, { invitation: started.text, ...(item === undefined ? {} : { ref: item.ref }) }, this.callOptions());
      if (!joined.ok) throw this.serviceFailed(names, base, joined);
      this.updateService(names, base, { reachedAt: this.nowSeconds(), failure: undefined });
      const took = await takeJoinedInvitation(this.wallet.backend, started, joined.invitation);
      if (!took.ok) throw new ServiceAnswerRefusedError(took.reason, took.code);
      const accepted = await checkOtherParticipant({
        template: definition,
        action: asked.action,
        walletRole: asked.role,
        otherRole: role,
        committed: took.taken.own,
        added: took.taken.others,
        chain: this.wallet.chain,
        now: Date.now(),
        answerBy: sentAt + SHARED_ANSWER_LIMIT_MS,
      });
      if (!accepted.ok) throw new ServiceAnswerRefusedError(accepted.reason, accepted.code);
      const notBrought = accepted.left.inputs.filter((input) => input !== frame.tokenInput?.input);
      if (notBrought.length > 0) return refuse(`The service did not bring ${notBrought.map((input) => `"${definition.inputs?.[input]?.name ?? input}"`).join(', ')}, which only it can give. Nothing was signed.`);
      // The whole action, by the rules of one the wallet carries out alone, with the service's coins in the template's order.
      const order = shape.inputs.map(({ input }) => input);
      const theirs = [...accepted.theirInputs].sort((a, b) => order.indexOf(a.inputIdentifier) - order.indexOf(b.inputIdentifier));
      const plan = await this.complete(
        {
          ...frame,
          values: { ...accepted.values },
          applicationCoins: theirs.map(({ inputIdentifier, index, utxo, lockingScript }) => ({ input: inputIdentifier, ...(index === undefined ? {} : { index }), utxo, lockingScript })),
          follow: new Map(),
          following: new Map(),
        },
        asked,
        defining,
      );
      for (const { coin, place } of committed) {
        if (place === undefined || plan.inputs[place]?.coin !== coin) return refuse('The service\'s part does not leave the wallet\'s coins where the wallet put them. Nothing was signed.');
      }
      return { request: asked, url: route.url, role, started, committed: committed.map(({ coin }) => coin), accepted, plan, ...(item === undefined ? {} : { item }), ...(plan.made === undefined ? {} : { made: plan.made }), virtual };
    } catch (error) {
      await this.wallet.backend.abandonShared(started.invitationIdentifier).catch(() => undefined);
      throw error;
    }
  }

  /** Put aside an invitation worked out with a service: the coins it held are free again. */
  private async putAside(pending: PendingShared): Promise<void> {
    await this.wallet.backend.abandonShared(pending.started.invitationIdentifier).catch(() => undefined);
  }

  /**
   * Put aside the action a review worked out with a service, when the user declines it or leaves the review: the coins
   * the invitation held are free again. Nothing is sent to the service.
   */
  async discardPreview(request: ApplicationAction): Promise<void> {
    const key = requestKey(request);
    const pending = this.pendingShared.get(key);
    if (pending === undefined) return;
    this.pendingShared.delete(key);
    await this.putAside(pending);
  }

  /**
   * The service's part of a review: its values by the template's names, and what it said beside them, less what it said
   * of a value the wallet's own role gives the action: that value is in the review already, as the action sets it, and
   * the service's word on it (what it is before the action) would stand beside it under the same name.
   */
  private servicePart(definition: ReadTemplate['definition'], pending: PendingShared): ServicePart {
    const variables = (definition.actions?.[pending.request.action]?.roles?.[pending.role]?.requirements?.variables ?? []) as string[];
    const walletGives = new Set((definition.actions?.[pending.request.action]?.roles?.[pending.request.role]?.requirements?.variables ?? []) as string[]);
    return {
      role: pending.role,
      roleName: definition.roles?.[pending.role]?.name ?? pending.role,
      url: pending.url,
      values: variables.flatMap((variable) => (pending.accepted.values[variable] === undefined ? [] : [statedValue(definition, variable, pending.accepted.values[variable])])),
      says: (pending.item?.says ?? []).filter(({ variable }) => !walletGives.has(variable)).map(({ variable, value }) => saidValue(definition, variable, value)),
    };
  }

  /**
   * Carry out an action another participant joins through the template's service, on the user's approval: the round the
   * review worked out (or a fresh one, for an approval given without a review), with every safeguard of an action the
   * wallet carries out alone: the user's tick, a position that is not confirmed, the template and the records stored in
   * the backup before anything is signed, the wallet paying itself first where it has no coin that can define a new
   * token, and what is built held against what was worked out. On any refusal or failure the invitation is put aside.
   */
  private async carryOutShared(request: ApplicationAction, route: { url: string; description: string }, onStage: (stage: 'recorded' | 'sent') => void, consent: ActionConsent): Promise<ActionOutcome> {
    const key = requestKey(request);
    const { template } = this.templateOf(request);
    let pending = this.pendingShared.get(key);
    // A tick not given leaves the review's invitation waiting, for the approval with the tick.
    if (pending !== undefined) this.requireTick(pending.plan, consent);
    this.pendingShared.delete(key);
    pending ??= await this.sharedRound(request, template, route);
    let held: ReservedAddress[] = [];
    let prepared: PreparedTransaction;
    let kept: KeptTemplate;
    try {
      // Everything that can refuse the action does so before the template is taken in.
      this.requireTick(pending.plan, consent);
      await this.onlyTakingOut(pending.plan, pending.request);
      kept = await this.ensureStored(await this.trustOnly(request.template, request.presented, request.application));
      onStage('recorded');
      if (pending.virtual) {
        // As for an action the wallet carries out alone, it first pays itself a coin that can define the new category,
        // then works the action out again with that coin: here with a fresh answer of the service, which may give the
        // wallet no less than was shown.
        const shown = pending;
        await this.putAside(shown);
        const { coin } = await this.wallet.payItself(shown.plan.payItself as bigint);
        pending = await this.sharedRound(request, template, route, coin);
        if (worseForTheWallet(shown.plan, pending.plan)) return refuse('The service\'s answer changed after the review: the wallet would give more or get less than was shown. Nothing was signed. Ask again.');
        this.requireTick(pending.plan, consent);
      }
      const { plan } = pending;
      await this.wallet.hold(plan.reserved);
      held = plan.reserved;
      // What the action leaves is recorded, from the transaction worked out, before anything is signed.
      await this.storeRecords(await this.recordsOf(plan, pending.request));
      const theirs = new Set(pending.accepted.theirOutputs.map(({ outputIdentifier }) => outputIdentifier));
      const finish: SharedActionFinish = {
        invitationIdentifier: pending.started.invitationIdentifier,
        inputs: plan.inputs.flatMap(({ coin, kind }, place) => (kind === 'own' || kind === 'tokens' ? [{ coin, place }] : [])),
        outputs: plan.outputs.flatMap(({ output, identifier, wallet }, place) =>
          identifier !== undefined && theirs.has(identifier) ? [] : [identifier === undefined || wallet === 'left over' ? { ...output, place } : { outputIdentifier: identifier, place }],
        ),
        theirCoins: pending.accepted.theirInputs.map(({ utxo }) => utxo),
      };
      const { committed } = pending;
      prepared = await (this.wallet.finishShared?.(finish, committed) ?? this.wallet.backend.finishShared(finish));
      try {
        this.check(plan, prepared);
      } catch (error) {
        await this.wallet.backend.discard(prepared.invitationIdentifier);
        throw error;
      }
    } catch (error) {
      // Nothing was sent and no signature left the wallet.
      await this.putAside(pending);
      this.wallet.giveBack(held);
      throw error;
    }
    await this.sendShared(pending.plan, prepared);
    onStage('sent');
    return this.afterSending(pending.plan, prepared, kept, pending.made);
  }

  /** Send what was built, as for an action the wallet carries out alone. */
  private async sendShared(plan: Plan, prepared: PreparedTransaction): Promise<void> {
    try {
      await this.wallet.send(prepared);
    } catch (error) {
      if (error instanceof Error && inputsSpentRefusal(error.message)) throw new InputsSpentError(error.message);
      throw error;
    } finally {
      this.wallet.keep(plan.used);
      this.wallet.giveBack(plan.reserved.filter((entry) => !plan.used.includes(entry)));
    }
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
    let deletedList = [...(this.state.deleted ?? [])];
    for (const { entry, standing, withdrawn, deleted } of templates) {
      const names: TemplateNames = { identifier: entry.identifier, contentHash: entry.contentHash };
      const texts: PresentedTexts = { template: entry.text };
      if (this.keptTemplate(names) !== undefined) continue;
      try {
        const renewal = entry.renewal ?? 0;
        const local = suggested.find((known) => same(known, names))?.withdrawn;
        const gone = deletedList.find((known) => same(known, names));
        if (standing === 'current owner' && withdrawn !== undefined && deleted === true) {
          // This seed deleted it: not offered again. The device keeps the mark's number, and only that.
          if (gone === undefined || gone.renewal < withdrawn || !gone.stored) {
            deletedList = [...deletedList.filter((known) => !same(known, names)), { ...names, renewal: Math.max(withdrawn, gone?.renewal ?? 0), stored: true, ...(gone?.withdrawnBefore === true ? { withdrawnBefore: true as const } : {}) }];
          }
          suggested = suggested.filter((candidate) => !(same(candidate, names) && (candidate.withdrawn === undefined || candidate.withdrawn.renewal <= withdrawn)));
        } else if (gone !== undefined && (standing === 'earlier owner' || gone.renewal >= renewal)) {
          // Deleted on this device, whether or not the backup has been told yet: neither trusted nor offered again.
        } else if (standing === 'current owner' && withdrawn !== undefined) {
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
          this.change({ suggested, deleted: deletedList });
          await this.trust(names, texts);
          this.updateTemplate(names.identifier, { stored: true, ...(renewal === 0 ? {} : { renewal }) });
          // Trusted again after a deletion: the device's mark of it has gone with the trust.
          deletedList = [...(this.state.deleted ?? [])];
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
    this.change({ suggested, notes, deleted: deletedList });
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
   * script, each whose script holds coins is listed as open, in the order the records were written, and the others
   * are not listed; none holding coins means closed. A record that names
   * no script and counts gives the token under its template's name, with no word on whether the position is
   * open. A record that does not count is shown as not confirmed. A record of a template the user does not trust
   * is not checked and gives no position: its token is listed by `tokens` as one of a template not trusted. A token without a record is not a position:
   * it is listed by `tokens` alone. A record whose NFT the wallet does not hold is no position.
   *
   * @param options.template - only records of this template
   * @param options.categories - only NFTs of these categories
   * @param options.trusting - a template the user is asked to trust together with an action: its records are
   *   checked as if it were trusted, since nothing is done unless the user approves
   * @throws when the chain cannot be read: the list is then not to be taken as empty
   */
  async recordedPositions(options: { template?: string; categories?: Set<string>; trusting?: ReadTemplate; holding?: TokenCoin } = {}): Promise<RecordedPosition[]> {
    await this.awaitOwnOutputs();
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
    const coins = withHeld(await this.wallet.tokenCoins(), options.holding).filter(({ coin }) => coin.utxo.output.token?.nft !== undefined);
    // The check reads the wallet's tokens too: with the one an invitation holds, where one does.
    const held = options.holding;
    const viewed: Pick<WalletParts, 'chain' | 'tokenCoins'> = held === undefined ? this.wallet : { chain: this.wallet.chain, tokenCoins: async () => withHeld(await this.wallet.tokenCoins(), held) };
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
        // A record of a template the user does not trust cannot be checked: its token is listed as a token of that
        // template, with the way to trust it, and not as a position the chain does not confirm.
        if (trusted(entry.templateIdentifier) === undefined) continue;
        const verdict = await check(entry, viewed, trusted(entry.templateIdentifier));
        // A record that counts belongs to the coin the check tied it to.
        if (verdict.counts && verdict.heldAt !== undefined && verdict.heldAt !== outpoint) continue;
        const script = verdict.lockingBytecode === undefined ? this.recordScript(entry) : hex(verdict.lockingBytecode);
        checked.push({ entry, standing, verdict, ...(script === undefined ? {} : { script }) });
      }
      const position = async (item: (typeof checked)[number], status: RecordedStatus, reason?: string): Promise<RecordedPosition> => {
        const lockingScript = item.entry.lockingScriptIdentifier === undefined ? undefined : (trusted(item.entry.templateIdentifier)?.definition.lockingScripts?.[item.entry.lockingScriptIdentifier] as { roles?: Record<string, { actions?: { action: string }[] }> } | undefined);
        const scriptActions = lockingScript?.roles?.[item.entry.roleIdentifier ?? '']?.actions?.map(({ action }) => action);
        // And those the template's service last said the token offers.
        const keptTemplate = this.keptById(item.entry.templateIdentifier);
        const serviceActions = keptTemplate === undefined ? [] : this.serviceActions(keptTemplate, category, new Set([category])).map(({ action }) => action).filter((action) => !(scriptActions ?? []).includes(action));
        const actions = scriptActions === undefined && serviceActions.length === 0 ? undefined : [...(scriptActions ?? []), ...serviceActions];
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
      // More than one can hold coins: a position that moved, and its earlier script that someone paid again.
      for (const item of filled) listed.push(await position(item, 'open'));
      if (filled.length === 0 && scripts.length > 0) listed.push(await position(scripts.at(-1) as (typeof checked)[number], 'closed'));
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
    // A category the request names whose token the wallet does not hold (one it made, waiting elsewhere) is no position of the wallet's.
    const about = new Set([
      ...(request.about === undefined || plan.token === undefined ? [] : [request.about.category]),
      ...(plan.token === undefined ? [] : [hex(plan.token.coin.utxo.output.token?.category ?? new Uint8Array())]),
    ]);
    const touched = new Set([...plan.outputs.filter(({ wallet }) => wallet === undefined).map(({ output }) => hex(output.lockingBytecode)), ...plan.inputs.filter(({ kind }) => kind === 'application').map(({ coin }) => hex(coin.utxo.output.lockingBytecode))]);
    const named = [...this.positionRecords, ...this.suggestedRecords].filter((entry) => entry.token !== undefined && touched.has(this.recordScript(entry) ?? '')).map((entry) => entry.token?.category as string);
    if (about.size === 0 && named.length === 0) return undefined;
    const listed = await this.recordedPositions({ categories: new Set([...about, ...named]), trusting: plan.template, ...(plan.token === undefined ? {} : { holding: plan.token }) });
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
    await this.awaitOwnOutputs();
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
      const registry = shownRegistry(this.options.registry?.(category), base.commitment);
      const named = registry === undefined ? {} : { registry };
      if (identifier === undefined) {
        held.push({ ...base, meaning: 'unknown', ...named });
        continue;
      }
      const kept = this.keptById(identifier);
      if (kept !== undefined) {
        const tokenName = record === undefined ? undefined : recordTokenName(readTemplate(kept.text).definition, record);
        held.push({
          ...base,
          ...(record === undefined ? named : {}),
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
        ...named,
      });
    }
    return markSameSymbols(held);
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
   *
   * For a template whose service takes part in its actions, the follow-up actions its service last said the token
   * offers come after, each one the template allows (a service cannot invent an action), with the time of that answer.
   * Nothing is asked of the service here.
   */
  offeredActions(position: Pick<RecordedPosition, 'template' | 'record' | 'status'>): TokenAction[] {
    const kept = this.keptById(position.template.identifier);
    if (kept === undefined) return [];
    const category = position.record.token?.category;
    const fromService = category === undefined ? [] : this.serviceActions(kept, category, new Set([category])).map(({ item: _item, place: _place, ...offer }) => offer);
    const fromScript = this.scriptActions(kept, position).filter((offer) => !fromService.some((known) => known.action === offer.action));
    return [...fromScript, ...fromService];
  }

  private scriptActions(kept: KeptTemplate, position: Pick<RecordedPosition, 'template' | 'record' | 'status'>): TokenAction[] {
    const { record } = position;
    const script = record.lockingScriptIdentifier;
    const role = record.roleIdentifier;
    if (script === undefined || role === undefined) return [];
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
  actionOn(position: Pick<RecordedPosition, 'token' | 'template' | 'record'> & Pick<Partial<RecordedPosition>, 'lockingBytecode'>, action: string, variables: Record<string, string | number> = {}): ApplicationAction {
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
      fromWallet: { typed: variables, ...(position.lockingBytecode === undefined ? {} : { script: position.lockingBytecode }) },
    };
  }
}
