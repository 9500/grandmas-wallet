import type { ChallengeDelay } from '@grandmas-wallet/core';

import type { AppChain } from './support.js';

/**
 * When a recovery request can be completed, worked out from the chain.
 *
 * The delay counts from the block that holds the request. Counted in blocks,
 * the completing transaction can be in a block once that many have followed.
 * A block here is a ten-minute block: on a network that has moved to shorter
 * blocks, the count is scaled up so that the delay lasts as long as before.
 * (Seen on chipnet after its change to one-minute blocks: a delay of 5 was
 * enforced as 50 blocks.)
 * Counted in time, the network compares block times as it sees them: the
 * median of the last eleven blocks, which trails the clock.
 */

export type Eligibility =
  /** The request is not in a block yet; the delay has not started. */
  | { ready: false; waitingFor: 'confirmation' }
  | { ready: false; waitingFor: 'blocks'; remaining: number }
  /** `remainingSeconds` is by the network's clock; real waiting time is somewhat longer. */
  | { ready: false; waitingFor: 'time'; remainingSeconds: number; readyAt: number }
  | { ready: true };

/** The network's clock after the block at `height`: the median time of it and the ten before. */
export const medianTimePast = async (chain: AppChain, height: number): Promise<number> => {
  const heights = Array.from({ length: 11 }, (_, offset) => height - offset).filter((value) => value >= 0);
  const times = await Promise.all(heights.map((value) => chain.headerTime(value)));
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
};

/**
 * @param requestHeight - height of the block holding the request; 0 or less while unconfirmed
 */
export const recoveryEligibility = async (chain: AppChain, requestHeight: number, delay: ChallengeDelay): Promise<Eligibility> => {
  if (requestHeight <= 0) return { ready: false, waitingFor: 'confirmation' };
  const tip = await chain.tip();
  if (delay.unit === 'blocks') {
    // The completing transaction can be in block (request height + delay), the next block after the tip at the earliest.
    const remaining = requestHeight + delay.value * (chain.blocksPerDelayBlock ?? 1) - (tip.height + 1);
    return remaining > 0 ? { ready: false, waitingFor: 'blocks', remaining } : { ready: true };
  }
  // The delay runs from the network's clock just before the request's block to the clock after the tip.
  const readyAt = (await medianTimePast(chain, requestHeight - 1)) + delay.value * 512;
  const clock = await medianTimePast(chain, tip.height);
  return clock >= readyAt ? { ready: true } : { ready: false, waitingFor: 'time', remainingSeconds: readyAt - clock, readyAt };
};

/** A delay in plain words. A delay in blocks is counted in ten-minute blocks on every network. */
export const describeDelay = (delay: ChallengeDelay): string => {
  const seconds = delay.unit === 'blocks' ? delay.value * 600 : delay.value * 512;
  const about = seconds < 5_400 ? `${Math.max(1, Math.round(seconds / 60))} minutes` : seconds < 172_800 ? `${Math.round(seconds / 3_600)} hours` : `${Math.round(seconds / 86_400)} days`;
  return delay.unit === 'blocks' ? `${delay.value} ten-minute blocks (about ${about})` : `about ${about}`;
};
