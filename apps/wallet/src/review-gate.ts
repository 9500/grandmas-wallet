import { type ActionPreview, type HeldToken, type RecordedPosition, type TokenLeaving, FindingRefusalError, NeedsApplicationError, NotStoredError } from '@grandmas-wallet/app';

/**
 * What the screens that review an action rest on, apart from how they look: when the approving button is shown and
 * when it works, the tick for tokens that leave the wallet, the words of a refusal, and how the wallet's tokens and
 * positions are listed (proposal sections 10.4, 12.5, 13.3 and 17). Nothing here names an application.
 */

/** The action has to be on a backup store before it is signed: its template, the first time, or the record of a position. */
export const needsStore = (preview: Pick<ActionPreview, 'firstUse' | 'recordsPosition'>): boolean => preview.firstUse || preview.recordsPosition === true;

/** The action does not deliver a token to the wallet unchanged, or sends elsewhere a token made from its coin: it asks for the user's tick. */
export const needsTick = (preview: Pick<ActionPreview, 'tokensLeaving'>): boolean => (preview.tokensLeaving ?? []).length > 0;

/**
 * Where the backup stands for an action that needs it: `none`, no backup store is set up; `checking`; `answers`, a
 * store answered just now; `unreachable`, none did.
 */
export type BackupState = 'none' | 'checking' | 'answers' | 'unreachable';

/** Why the approving button is not there, or does not work yet. */
export type Blocked = 'working out' | 'refused' | 'no backup' | 'checking backup' | 'backup unreachable' | 'tick';

export interface Gate {
  /** The approving button is on the screen. */
  shown: boolean;
  /** It can be pressed. */
  enabled: boolean;
  /** The review asks for the tick. */
  tick: boolean;
  blocked?: Blocked;
}

/**
 * The approving button of a review. It is not offered while the action is being worked out, where the wallet
 * refuses it, without a backup store, or while no backup store answers; it is offered and does not work until the
 * user ticks, where tokens leave the wallet.
 */
export const approval = (state: { preview?: Pick<ActionPreview, 'firstUse' | 'recordsPosition' | 'tokensLeaving'>; refused: boolean; backup: BackupState; ticked: boolean }): Gate => {
  const { preview } = state;
  const tick = preview !== undefined && !state.refused && needsTick(preview);
  const off = (blocked: Blocked): Gate => ({ shown: false, enabled: false, tick, blocked });
  if (state.refused) return off('refused');
  if (preview === undefined) return off('working out');
  if (needsStore(preview)) {
    if (state.backup === 'none') return off('no backup');
    if (state.backup === 'unreachable') return off('backup unreachable');
    if (state.backup === 'checking') return { shown: true, enabled: false, tick, blocked: 'checking backup' };
  }
  if (tick && !state.ticked) return { shown: true, enabled: false, tick, blocked: 'tick' };
  return { shown: true, enabled: true, tick };
};

/** The consent `carryOut` and a request's approval take: the tick, where one was asked for. */
export const consentOf = (gate: Pick<Gate, 'tick'>, ticked: boolean): { tokensLeave?: true } => (gate.tick && ticked ? { tokensLeave: true } : {});

// ------------------------------------------------------------------ refusals

export const BACKUP_UNREACHABLE = 'Your backup can\'t be reached. Try again in a moment.';

/** A refusal, as a screen shows it in place of the review: a title, one plain line, and what lies behind a "?". */
export interface Refusal {
  kind: 'ties to phone' | 'cannot tell' | 'application' | 'backup' | 'other';
  title: string;
  words: string;
  /** The wallet's full reason, behind a "?". */
  detail?: string;
  /** For an action done through the application: the address of its page. */
  page?: string;
}

/**
 * The words of a refusal. What the wallet found about what an action leaves behind, and a backup that cannot be
 * reached, are said in a plain line that is never behind a "?"; the wallet's full reason is.
 * @param otherwise - the words for any other refusal
 */
export const refusalOf = (error: unknown, otherwise: string): Refusal => {
  if (error instanceof FindingRefusalError) {
    return error.finding.finding === 'cannot tell'
      ? { kind: 'cannot tell', title: 'This wallet won\'t do this', words: 'It can\'t tell whether this money would come back if the phone is lost.', detail: error.message }
      : { kind: 'ties to phone', title: 'This wallet won\'t do this', words: 'This would tie money to this phone alone. If the phone is lost, nobody can get it back.', detail: error.message };
  }
  if (error instanceof NeedsApplicationError) {
    const reason = error.message.replace(/^Open the application to do this(: \S+)?\. /, '');
    return { kind: 'application', title: 'Open the application to do this', words: error.page === undefined ? 'This wallet can\'t do it by itself.' : 'This wallet can\'t do it by itself. Its page:', detail: reason, ...(error.page === undefined ? {} : { page: error.page }) };
  }
  if (error instanceof NotStoredError && /Try again when a store can be reached/.test(error.message)) {
    return { kind: 'backup', title: 'Not carried out', words: BACKUP_UNREACHABLE, detail: error.message };
  }
  return { kind: 'other', title: 'This wallet would not carry it out', words: otherwise };
};

// ------------------------------------------------------------------ tokens that leave the wallet

/** What happens to a token that an action does not deliver to the wallet unchanged, in a short plain line. */
export const leavingLine = (leaving: TokenLeaving): string => {
  const to = leaving.to === undefined ? undefined : `"${leaving.to}"`;
  if (leaving.made === true) return leaving.how === 'ends' ? 'Made now from your coin, and destroyed at once.' : `Made now from your coin, it goes to ${to ?? 'someone else'}, not to this wallet.`;
  if (leaving.how === 'leaves') return `It goes to ${to ?? 'someone else'} and leaves this wallet.`;
  if (leaving.how === 'changes') return 'It comes back changed.';
  return 'It is destroyed. Nobody can use it again.';
};

/** The heading over the tokens an action does not deliver unchanged, and the words of the tick. */
export const leavingWords = (leaving: TokenLeaving[]): { title: string; tick: string } => {
  const one = leaving.length === 1;
  const away = leaving.every(({ how }) => how === 'leaves');
  const title = !one ? `${leaving.length} tokens don't come back as they are` : leaving[0]?.made === true ? 'A new token goes elsewhere' : leaving[0]?.how === 'leaves' ? 'Your token leaves this wallet' : leaving[0]?.how === 'changes' ? 'Your token comes back changed' : 'Your token is destroyed';
  const tick = away ? `I understand that whoever gets ${one ? 'this token' : 'these tokens'} gets what ${one ? 'it controls' : 'they control'}` : `I understand what happens to ${one ? 'this token' : 'these tokens'}`;
  return { title, tick };
};

// ------------------------------------------------------------------ the list of tokens and positions

export interface TokenList {
  /** Positions whose record the chain confirms: open or closed. */
  positions: RecordedPosition[];
  /**
   * Tokens whose record names no script: under the template's name, with no word on whether the position is open.
   * What they control is the application's to show, at the page the record names.
   */
  held: RecordedPosition[];
  /** Positions whose record the chain does not confirm: listed apart. */
  unconfirmed: RecordedPosition[];
  /** Every other token: one that no record lists as a position. Each can be sent. */
  tokens: HeldToken[];
}

/**
 * The wallet's tokens as the Applications screen lists them (sections 10.4 and 17): positions from records, those not
 * confirmed apart, and every other token as a token.
 */
export const tokenList = (recorded: RecordedPosition[], tokens: HeldToken[]): TokenList => {
  const listed = new Set(recorded.map((position) => position.token.outpoint));
  return {
    positions: recorded.filter(({ status }) => status === 'open' || status === 'closed'),
    held: recorded.filter(({ status }) => status === 'held'),
    unconfirmed: recorded.filter(({ status }) => status === 'unconfirmed'),
    tokens: tokens.filter((token) => !listed.has(token.outpoint)),
  };
};
