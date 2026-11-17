import { type ChallengeDelay, type ControllerHistory, controllerScript } from '@grandmas-wallet/core';

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

/** When the waiting period of a pending request ends, as far as the chain shows it. */
export interface RequestTiming {
  eligibility: Eligibility;
  /** By the chain's clock, for a delay counted in time: Unix seconds. */
  endsAt?: number;
  /** About how many seconds are left. Not known before the request is in a block. */
  secondsLeft?: number;
}

/**
 * Where the waiting period of the request in a controller's last transaction stands.
 *
 * @param secondsPerBlock - how often this network's blocks come, for a delay counted in blocks
 */
export const requestTiming = async (chain: AppChain, identity: Uint8Array, history: ControllerHistory, secondsPerBlock: number): Promise<RequestTiming> => {
  const last = history.transactions.at(-1);
  const entries = await chain.getHistory(controllerScript(identity).lockingBytecode);
  const height = entries.find((entry) => entry.transactionId === last?.transactionId)?.height ?? 0;
  const eligibility = await recoveryEligibility(chain, height, history.current.state.challengeDelay);
  if (eligibility.ready) return { eligibility, secondsLeft: 0 };
  if (eligibility.waitingFor === 'time') return { eligibility, endsAt: eligibility.readyAt, secondsLeft: eligibility.remainingSeconds };
  if (eligibility.waitingFor === 'blocks') return { eligibility, secondsLeft: eligibility.remaining * secondsPerBlock };
  return { eligibility };
};

/** How long a delay lasts, in seconds. A delay in blocks is counted in ten-minute blocks on every network. */
export const delaySeconds = (delay: ChallengeDelay): number => (delay.unit === 'blocks' ? delay.value * 600 : delay.value * 512);

/** A delay in plain words. */
export const describeDelay = (delay: ChallengeDelay): string => {
  const seconds = delaySeconds(delay);
  const count = (amount: number, unit: string): string => `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  // Minutes up to 50, then hours to the half hour up to six, then whole hours, then days.
  const about =
    seconds < 3_300
      ? count(Math.max(1, Math.round(seconds / 60)), 'minute')
      : seconds < 21_600
        ? count(Math.round(seconds / 1_800) / 2, 'hour')
        : seconds < 172_800
          ? count(Math.round(seconds / 3_600), 'hour')
          : count(Math.round(seconds / 86_400), 'day');
  return delay.unit === 'blocks' ? `${delay.value} ten-minute blocks (about ${about})` : `about ${about}`;
};
