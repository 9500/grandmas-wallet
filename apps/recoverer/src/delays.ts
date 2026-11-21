import type { ChallengeDelay } from '@grandmas-wallet/core';

/** Waiting periods to choose from, counted by the chain's clock in steps of 512 seconds. */
export const DELAYS: { delay: ChallengeDelay; hint: string }[] = [
  { delay: { unit: 'time512', value: 1 }, hint: 'For trying the wallet out. Too short to rely on.' },
  { delay: { unit: 'time512', value: 7 }, hint: 'Enough if the owner\'s phone is nearly always on and online.' },
  { delay: { unit: 'time512', value: 169 }, hint: 'A day for the owner\'s phone to notice a request and refuse it.' },
  { delay: { unit: 'time512', value: 1182 }, hint: 'A week. Safer, and a lost phone takes a week to replace.' },
];

/** The waiting periods offered on a network: on mainnet, not the one for trying the wallet out. */
export const delaysFor = (network: string): typeof DELAYS => (network === 'mainnet' ? DELAYS.filter((entry) => !(entry.delay.unit === 'time512' && entry.delay.value === 1)) : DELAYS);

/** A new wallet's waiting period until the recoverer chooses one: about a day on mainnet, 512 seconds on a test network. */
export const defaultChallengeDelay = (network: string): ChallengeDelay => ({ unit: 'time512', value: network === 'mainnet' ? 169 : 1 });
