import type { WatchStatus } from './monitor.js';

/**
 * What the wallet may say about how well it is protected (proposal sections 17 and 19).
 *
 * Refusing a recovery request takes three things: the device has to be running to see the request, it has
 * to hold a coin that pays for the cancellation, and the recoverer has to hold what a recovery needs for
 * recovery to be worth protecting at all. The wallet does not show full protection when one of them is
 * missing, and it says which. In particular it says when it was not running for part of a waiting period:
 * it could not watch then, and it does not pretend otherwise.
 */

/** When this device was running and watching, as it recorded it itself. Unix seconds, oldest first. */
export interface WatchLog {
  spans: { from: number; to: number }[];
}

export const emptyWatchLog = (): WatchLog => ({ spans: [] });

/**
 * Record that the device is watching now. A check that follows the last one closely extends the same span;
 * after a longer silence a new span begins, and the time between is time the device did not watch.
 *
 * @param longestSilence - seconds between two checks that still count as watching without a break
 * @param keep - how many spans are kept
 */
export const noteWatching = (log: WatchLog, now: number, longestSilence = 180, keep = 200): WatchLog => {
  const last = log.spans.at(-1);
  if (last !== undefined && now - last.to <= longestSilence) {
    return { spans: [...log.spans.slice(0, -1), { from: last.from, to: Math.max(last.to, now) }] };
  }
  return { spans: [...log.spans, { from: now, to: now }].slice(-keep) };
};

/** The parts of a stretch of time in which the device was not watching. */
export const unwatched = (log: WatchLog, from: number, to: number): { from: number; to: number }[] => {
  const gaps: { from: number; to: number }[] = [];
  let cursor = from;
  for (const span of log.spans) {
    if (span.to <= cursor) continue;
    if (span.from >= to) break;
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < to) gaps.push({ from: cursor, to });
  return gaps;
};

export interface ProtectionInput {
  /** Whether the recoverer's receipt makes recovery on. */
  recovery: 'on' | 'off';
  /** Whether the wallet holds the coin that pays for one cancellation. */
  canCancel: boolean;
  /** What the chain shows of the controller, for this device's keys. */
  watch: WatchStatus;
  /** A request that is pending: when it was made and when its waiting period ends, by the chain's clock. Unix seconds. */
  wait?: { from: number; until: number };
  log: WatchLog;
  /** Unix seconds. */
  now: number;
  /** Whether what the servers say can be taken as settled (several servers, none disagreeing, headers checked). */
  chainVerified: boolean;
}

export interface Protection {
  /** Whether the wallet may show full protection. */
  full: boolean;
  /** Whether the wallet can refuse a request right now. */
  canRefuse: boolean;
  /** What is missing, in the words shown to the user. Empty when protection is full. */
  gaps: string[];
  /** The stretches of a pending waiting period in which this device was not running. */
  notWatched: { from: number; to: number }[];
}

const at = (seconds: number): string => `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const lasting = (seconds: number): string => (seconds >= 7200 ? `${Math.round(seconds / 3600)} hours` : `${Math.max(1, Math.round(seconds / 60))} minutes`);

/** What the wallet says about its protection, and whether it may call it full. */
export const assessProtection = (input: ProtectionInput): Protection => {
  const gaps: string[] = [];
  const { watch } = input;
  if (watch.kind === 'closed') return { full: false, canRefuse: false, gaps: ['This wallet has been closed.'], notWatched: [] };
  if (watch.kind === 'owned-elsewhere') {
    return { full: false, canRefuse: false, gaps: ['Another key owns this wallet. This device can no longer refuse anything; it can still move out coins that have not been swept.'], notWatched: [] };
  }
  if (!input.canCancel) gaps.push('The wallet holds no coin for cancelling. It cannot refuse a recovery request until one is put aside.');
  if (input.recovery === 'off') gaps.push('Recovery is not on: no receipt of the recoverer matches what this wallet sent. If this device is lost, the wallet may not be recoverable.');
  if (!input.chainVerified) gaps.push('What the servers say could not be checked against each other. Nothing is treated as final until it can.');
  let notWatched: { from: number; to: number }[] = [];
  if (input.wait !== undefined && watch.kind === 'recovery-requested') {
    notWatched = unwatched(input.log, input.wait.from, Math.min(input.now, input.wait.until));
    const missed = notWatched.reduce((sum, gap) => sum + (gap.to - gap.from), 0);
    // Shorter breaks than a block's time are not worth a statement.
    if (missed >= 60) {
      const [first] = notWatched;
      gaps.push(
        `This device was not running for ${lasting(missed)} of the waiting period${first === undefined ? '' : ` (first from ${at(first.from)} to ${at(first.to)})`}. It could not watch then. The request is shown now; had the waiting period ended in that time, the device could not have refused it.`,
      );
    }
    const left = input.wait.until - input.now;
    gaps.push(left > 0 ? `A recovery request is waiting. It can be refused for about ${lasting(left)} more.` : 'A recovery request is waiting and its waiting period has passed. It can be completed at any moment; refuse it now if it is not yours.');
  }
  return { full: gaps.length === 0, canRefuse: input.canCancel, gaps, notWatched };
};
