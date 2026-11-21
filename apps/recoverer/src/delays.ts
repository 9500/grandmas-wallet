import type { ChallengeDelay } from '@grandmas-wallet/core';

/** Waiting periods to choose from, counted by the chain's clock in steps of 512 seconds. */
export const DELAYS: { delay: ChallengeDelay; hint: string }[] = [
  { delay: { unit: 'time512', value: 1 }, hint: 'For trying the wallet out. Too short to rely on.' },
  { delay: { unit: 'time512', value: 7 }, hint: 'Enough if the owner\'s phone is nearly always on and online.' },
  { delay: { unit: 'time512', value: 169 }, hint: 'A day for the owner\'s phone to notice a request and refuse it.' },
  { delay: { unit: 'time512', value: 1182 }, hint: 'A week. Safer, and a lost phone takes a week to replace.' },
];

/** What the shortest waiting period comes to on mainnet, where the chain's clock moves only about every ten minutes. */
const SHORTEST_ON_MAINNET = 'The shortest the network can measure. On mainnet a move with it usually takes about half an hour, and a few hours when blocks are slow. Too short to rely on.';

/**
 * The waiting periods offered on a network: the same on every one, the shortest among them. On mainnet the shortest
 * says what it comes to there.
 */
export const delaysFor = (network: string): typeof DELAYS =>
  network === 'mainnet' ? DELAYS.map((entry) => (entry.delay.unit === 'time512' && entry.delay.value === 1 ? { ...entry, hint: SHORTEST_ON_MAINNET } : entry)) : DELAYS;

/** A new wallet's waiting period until the recoverer chooses one: about a day on mainnet, 512 seconds on a test network. */
export const defaultChallengeDelay = (network: string): ChallengeDelay => ({ unit: 'time512', value: network === 'mainnet' ? 169 : 1 });
