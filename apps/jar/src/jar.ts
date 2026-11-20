import { binToHex, hexToBin } from '@bitauth/libauth';
import { readTemplate } from '@grandmas-wallet/core';
import { savingsJarScript, savingsJarV4TemplateText, unlockTimeOf } from '@grandmas-wallet/savings-jar';

/**
 * What both kinds of wallet share on this page: the template as a wallet is sent it, what a jar is as the
 * page shows it, and the clock the network goes by.
 */

const read = readTemplate(savingsJarV4TemplateText);

/**
 * The template, version 4, which a wallet is sent with nothing beside it (proposal section 15.3): the text, and
 * the names a request gives it.
 */
export const JAR_TEMPLATE = {
  names: { identifier: read.identifier, contentHash: read.contentHash },
  texts: { template: savingsJarV4TemplateText },
} as const;

/** What the key output holds, as in the template. It comes back to the wallet with the key. */
export const KEY_SATOSHIS = 1_000n;

/**
 * The smallest first deposit the page offers. Emptying a jar costs a fee of a few hundred satoshis, paid
 * from the jar; below this, too little would come out to be worth it.
 */
export const SMALLEST_JAR = 2_000n;

/** Before this number a lock time is a block height, from it on a Unix time. */
export const EARLIEST_TIME = 500_000_000;

/** A jar as the page shows it, whichever kind of wallet holds its key. */
export interface JarView {
  /** The key's category, hex in the byte order explorers show. Names the jar. */
  category: string;
  /** Unix seconds, or a block height below 500,000,000. */
  unlockTime: number;
  satoshis: bigint;
  /** The jar's locking bytecode, hex: where anyone pays in. */
  lockingBytecode: string;
  /**
   * `open` holds savings; `empty` was emptied (the key is kept); `unconfirmed`: the wallet's record of the jar is
   * not borne out by the chain, and the wallet only takes money out of it; `unknown` could not be worked out.
   */
  status: 'open' | 'empty' | 'unconfirmed' | 'unknown';
}

/** The address of the jar a key opens: P2SH32 of the contract with the key's category and date. */
export const jarLockingBytecode = (category: string, unlockTime: number): string => binToHex(savingsJarScript(hexToBin(category), unlockTime).lockingBytecode);

/** The date on a key, or `undefined` if its commitment is not one. */
export const dateOnKey = (commitmentHex: string): number | undefined => {
  if (!/^([0-9a-f]{2}){1,5}$/i.test(commitmentHex)) return undefined;
  try {
    return unlockTimeOf(hexToBin(commitmentHex));
  } catch {
    return undefined;
  }
};

export const byDate = (a: JarView, b: JarView): number => a.unlockTime - b.unlockTime || a.category.localeCompare(b.category);

// ------------------------------------------------------------------ the network's clock

/** What the page needs to read the network's clock. */
export interface ClockSource {
  tip(): Promise<{ height: number; time: number }>;
  headerTime(height: number): Promise<number>;
}

/**
 * The network's clock: the median time of the last eleven blocks. A transaction whose lock time is a date
 * is taken only once this has passed that date, so a jar opens some minutes after its date.
 */
export const networkTime = async (chain: ClockSource): Promise<{ height: number; medianTime: number }> => {
  const { height } = await chain.tip();
  const heights = Array.from({ length: Math.min(11, height + 1) }, (_, offset) => height - offset);
  const times = (await Promise.all(heights.map((at) => chain.headerTime(at)))).sort((a, b) => a - b);
  return { height, medianTime: times[Math.floor(times.length / 2)] ?? 0 };
};

/** Where a jar stands in time. */
export type Readiness =
  /** Its date is still ahead. */
  | { kind: 'locked'; secondsLeft: number | undefined }
  /** The date has passed, but not yet by the network's clock. */
  | { kind: 'network'; secondsLeft: number | undefined }
  | { kind: 'ready' };

/**
 * @param now - Unix seconds by this device's clock
 * @param network - the network's clock, if it could be read
 */
export const readiness = (unlockTime: number, now: number, network: { height: number; medianTime: number } | undefined): Readiness => {
  if (unlockTime < EARLIEST_TIME) {
    // A block height: the network takes it once the next block is above it.
    if (network === undefined) return { kind: 'ready' };
    return network.height >= unlockTime ? { kind: 'ready' } : { kind: 'locked', secondsLeft: undefined };
  }
  if (now < unlockTime) return { kind: 'locked', secondsLeft: unlockTime - now };
  if (network === undefined) return { kind: 'ready' };
  return network.medianTime > unlockTime ? { kind: 'ready' } : { kind: 'network', secondsLeft: Math.max(60, unlockTime - network.medianTime + 60) };
};

// ------------------------------------------------------------------ dates as a person enters them

/** `YYYY-MM-DDTHH:MM` in this device's time zone, for a date and time field. */
export const localInput = (unixSeconds: number): string => {
  const date = new Date(unixSeconds * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
};

/** A date and time field's value, read in this device's time zone, as Unix seconds. */
export const fromLocalInput = (text: string): number | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) ? undefined : Math.floor(date.getTime() / 1000);
};

/** A date some way ahead, on the minute. */
export const ahead = (now: number, seconds: number): number => Math.ceil((now + seconds) / 60) * 60;

/**
 * Whether a date can be a jar's.
 * @returns a reason, or `undefined`
 */
export const dateProblem = (unlockTime: number | undefined, now: number): string | undefined => {
  if (unlockTime === undefined) return 'Enter a date and a time.';
  if (unlockTime <= now) return 'Choose a date in the future.';
  if (unlockTime > 0xffffffff) return 'That date is further ahead than the network can count.';
  return undefined;
};

/** Whether an amount can be a jar's first deposit. */
export const amountProblem = (satoshis: bigint, smallest: bigint = SMALLEST_JAR): string | undefined =>
  satoshis < smallest ? `A jar starts with at least ${smallest.toLocaleString('en-US')} satoshis, so that emptying it is worth its fee.` : undefined;

// ------------------------------------------------------------------ what a refusal means

/** Why a withdrawal is refused shortly after a jar's date. */
export const TOO_EARLY =
  'The network does not take this yet. It goes by the median time of the last eleven blocks, which runs some minutes behind the clock, and a jar opens once that time has passed its date. Try again in a few minutes.';

/** A refusal for a lock time that has not passed, by the network or in a wallet's words. */
export const isTooEarly = (message: string): boolean => /non-?final/i.test(message) && !/BIP68/i.test(message);

/** A refusal as the page shows it: the wallet's or the network's words, and what they mean where that helps. */
export const explain = (message: string): string => (isTooEarly(message) && message !== TOO_EARLY ? `${message.replace(/\.?$/, '.')} ${TOO_EARLY}` : message);
