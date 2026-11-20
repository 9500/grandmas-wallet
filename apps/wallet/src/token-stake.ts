import type { HeldToken, RecordedPosition } from '@grandmas-wallet/app';

/**
 * What goes with an NFT when it is sent, from what the wallet knows by itself: the record that ties it to a position,
 * the template's names, and for a position at a script of its own what that script holds on chain now (proposal
 * sections 10.4 and 17). No application is known here: a position at a script many users share is the application's
 * to show, at the page its record names.
 */
export interface TokenStake {
  /** The template a record ties the token to, by its name. */
  template?: string;
  /** What the position holds, as far as the wallet can tell. */
  holds:
    /** A script of the position's own holds coins: in all, at so many scripts. */
    | { kind: 'amount'; satoshis: bigint; places: number }
    /** Its script holds nothing now. */
    | { kind: 'nothing' }
    /** The record names no script: the application shows what it holds, at its page where the record names one. */
    | { kind: 'application'; page?: string }
    /** The chain does not bear out the record. */
    | { kind: 'not confirmed' }
    /** The positions are not read yet, or could not be. */
    | { kind: 'not read' }
    /** A record names a template this phone does not trust. */
    | { kind: 'untrusted' }
    /** No record ties the token to anything. */
    | { kind: 'none' };
  /** What a capability lets the token's holder do besides. */
  capability?: 'minting' | 'mutable';
}

/**
 * What a token is called in the wallet's list (proposal section 17): an NFT that a record ties to a position by the
 * template's name for it, or the template's name; a token that no record ties to anything by the name of the template
 * a note of the second design gives for it, where the note gives one; otherwise as a token of unknown meaning.
 */
export const tokenTitle = (token: HeldToken): string => (token.meaning === 'unknown' ? (token.template?.name ?? 'A token of unknown meaning') : (token.tokenName ?? token.template?.name ?? 'A token'));

/**
 * What sending this NFT gives away.
 * @param positions - the positions of the wallet's records as last read, or `undefined` while they are not
 */
export const tokenStake = (token: HeldToken, positions: RecordedPosition[] | undefined): TokenStake => {
  const capability = token.capability === 'minting' || token.capability === 'mutable' ? { capability: token.capability } : {};
  const template = token.template === undefined ? {} : { template: token.template.name };
  // A note of the second design may name a template; no record ties the token to a position.
  if (token.meaning === 'unknown') return { ...template, holds: { kind: 'none' }, ...capability };
  if (token.meaning === 'incomplete') return { ...template, holds: { kind: 'untrusted' }, ...capability };
  const own = positions?.filter((position) => position.token.outpoint === token.outpoint) ?? [];
  const confirmed = own.filter((position) => position.status !== 'unconfirmed');
  const named = template.template ?? own.find((position) => position.template.name !== undefined)?.template.name;
  const base = named === undefined ? {} : { template: named };
  const shared = confirmed.find((position) => position.status === 'held');
  if (shared !== undefined) {
    const page = shared.page ?? shared.record.applicationPage;
    return { ...base, holds: { kind: 'application', ...(page === undefined ? {} : { page }) }, ...capability };
  }
  const open = confirmed.filter((position) => position.status === 'open' && position.satoshis !== undefined);
  if (open.length > 0) return { ...base, holds: { kind: 'amount', satoshis: open.reduce((sum, position) => sum + (position.satoshis ?? 0n), 0n), places: open.length }, ...capability };
  if (confirmed.some((position) => position.status === 'closed')) return { ...base, holds: { kind: 'nothing' }, ...capability };
  if (own.length > 0) return { ...base, holds: { kind: 'not confirmed' }, ...capability };
  return { ...base, holds: { kind: 'not read' }, ...capability };
};

/** What a capability lets the token's holder do, in plain words. */
export const CAPABILITY_WORDS: Record<'minting' | 'mutable', string> = {
  minting: 'It can make new tokens of its category: whoever holds it can create more of them, fungible or NFTs, as many as they like.',
  mutable: 'Whoever holds it can change what is written on it, its commitment, each time they move it.',
};

/** The line in view: what the token controls, or, for a token no record ties to anything, what its capability allows. */
export const stakeHeadline = (stake: TokenStake): string => {
  if (stake.holds.kind === 'untrusted') return stake.template === undefined ? 'A record ties it to a template this phone does not have.' : `A record ties it to "${stake.template}", a template this phone does not trust yet.`;
  if (stake.holds.kind === 'none') return stake.capability !== undefined ? CAPABILITY_WORDS[stake.capability] : stake.template === undefined ? 'Nothing here says what it controls.' : `No record ties it to a position of "${stake.template}".`;
  return stake.template === undefined ? 'It controls a position of an application.' : `It controls a position of "${stake.template}".`;
};
