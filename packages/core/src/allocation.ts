import { type AddressKind, ADDRESS_KIND } from './addresses.js';
import { ADDRESS_RANGE, ADDRESS_WINDOW } from './wallet-addresses.js';

/**
 * Giving out addresses (proposal section 7.7): a counter for each kind, kept inside a window past the last
 * used address and inside the range of the kind.
 *
 * The state is plain data that a device stores. Every function returns a new state and leaves the one it
 * was given unchanged, so a device records a number as taken by storing the new state, and only then shows
 * the address. Two requests are served one after the other from the latest state, so they never get the
 * same number and never pass a limit together.
 */

export interface KindAllocation {
  /** How many numbers have been handed out so far: the next fresh number. */
  next: number;
  /** The highest number that has history on chain, or -1 when none has. */
  highestUsed: number;
  /** Numbers that have history on chain. */
  used: number[];
  /** Numbers handed out for something that has not been shown to anyone or signed yet. */
  held: number[];
  /** Numbers that were handed out and given back unused; they are handed out again first. */
  free: number[];
}

export type Allocation = Record<AddressKind, KindAllocation>;

const emptyKind = (): KindAllocation => ({ next: 0, highestUsed: -1, used: [], held: [], free: [] });

export const emptyAllocation = (): Allocation => ({
  [ADDRESS_KIND.givenOut]: emptyKind(),
  [ADDRESS_KIND.change]: emptyKind(),
  [ADDRESS_KIND.vault]: emptyKind(),
});

export type AllocationRefusal =
  /** The window past the last used address is full. `offer` is the oldest address already given out and not yet used. */
  | { reason: 'window-full'; offer: number }
  /** Every number of the range has been given out. `offer` is an address to use again. */
  | { reason: 'range-used-up'; offer: number };

export type AllocationResult = { allocation: Allocation; number: number } | { allocation: Allocation; refused: AllocationRefusal };

const withKind = (allocation: Allocation, kind: AddressKind, change: Partial<KindAllocation>): Allocation => ({
  ...allocation,
  [kind]: { ...allocation[kind], ...change },
});

/** The highest number the window allows for a kind. */
const windowLimit = (state: KindAllocation, kind: AddressKind): number => state.highestUsed + ADDRESS_WINDOW[kind];

/** The oldest address that was given out and has no history yet; when every one has, the newest given out. */
const offerOf = (state: KindAllocation): number => {
  const used = new Set(state.used);
  for (let number = 0; number < state.next; number++) {
    if (!used.has(number) && !state.held.includes(number) && !state.free.includes(number)) return number;
  }
  return Math.max(0, state.next - 1);
};

/**
 * Hand out the next number of a kind for something that is about to happen. It is held until
 * {@link keepNumber} says it was shown or signed for, or {@link returnNumber} gives it back.
 */
export const takeNumber = (allocation: Allocation, kind: AddressKind): AllocationResult => {
  const state = allocation[kind];
  const limit = windowLimit(state, kind);
  // A number given back unused is handed out again before a fresh one.
  const reusable = [...state.free].sort((a, b) => a - b).find((number) => number <= limit);
  if (reusable !== undefined) {
    return {
      number: reusable,
      allocation: withKind(allocation, kind, { free: state.free.filter((number) => number !== reusable), held: [...state.held, reusable] }),
    };
  }
  if (state.next >= ADDRESS_RANGE[kind]) {
    return { allocation, refused: { reason: 'range-used-up', offer: offerOf(state) } };
  }
  if (state.next > limit) {
    return { allocation, refused: { reason: 'window-full', offer: offerOf(state) } };
  }
  return { number: state.next, allocation: withKind(allocation, kind, { next: state.next + 1, held: [...state.held, state.next] }) };
};

const requireHeld = (state: KindAllocation, number: number): void => {
  if (!state.held.includes(number)) throw new Error(`Number ${number} is not held for anything.`);
};

/** The address was shown to someone, or a signature that names it left the wallet: the number stays taken for good. */
export const keepNumber = (allocation: Allocation, kind: AddressKind, number: number): Allocation => {
  requireHeld(allocation[kind], number);
  return withKind(allocation, kind, { held: allocation[kind].held.filter((held) => held !== number) });
};

/** What the number was for did not happen, and the address was never shown and nothing was signed: it may be handed out again. */
export const returnNumber = (allocation: Allocation, kind: AddressKind, number: number): Allocation => {
  const state = allocation[kind];
  requireHeld(state, number);
  return withKind(allocation, kind, { held: state.held.filter((held) => held !== number), free: [...state.free, number] });
};

/**
 * An address was seen to have history on chain, which includes a transaction of the wallet's own that is
 * not confirmed yet. The window moves on from it. Numbers found by a search that this device never handed
 * out are taken account of: the counter never hands out a number at or below one that was used.
 */
export const markUsed = (allocation: Allocation, kind: AddressKind, number: number): Allocation => {
  const state = allocation[kind];
  if (!Number.isInteger(number) || number < 0 || number >= ADDRESS_RANGE[kind]) {
    throw new Error(`Addresses of this kind are numbered 0 to ${ADDRESS_RANGE[kind] - 1}, got ${number}.`);
  }
  if (state.used.includes(number)) return allocation;
  return withKind(allocation, kind, {
    used: [...state.used, number].sort((a, b) => a - b),
    highestUsed: Math.max(state.highestUsed, number),
    next: Math.max(state.next, number + 1),
    held: state.held.filter((held) => held !== number),
    free: state.free.filter((free) => free !== number),
  });
};

/**
 * The addresses a wallet watches for one kind: every number handed out so far, and the window beyond the
 * last used one.
 */
export const watchedNumbers = (allocation: Allocation, kind: AddressKind): number[] => {
  const state = allocation[kind];
  const upTo = Math.min(ADDRESS_RANGE[kind] - 1, Math.max(state.next - 1, windowLimit(state, kind)));
  const free = new Set(state.free);
  return Array.from({ length: upTo + 1 }, (_, number) => number).filter((number) => !free.has(number) || number <= windowLimit(state, kind));
};

/** The allocation a device starts from when all it knows is which addresses a search found in use. */
export const allocationFromUsed = (used: { kind: AddressKind; number: number }[]): Allocation =>
  used.reduce((allocation, { kind, number }) => markUsed(allocation, kind, number), emptyAllocation());

