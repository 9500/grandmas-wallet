/**
 * How the wallet's screens write an amount of fungible tokens: in raw units, with the category beside it where it is
 * shown. No template gives tokens a name, a symbol or decimals here (proposal section 13.3).
 */

/** `12,345 units`, always without a sign. */
export const rawUnits = (amount: bigint): string => `${(amount < 0n ? -amount : amount).toLocaleString('en-US')} ${amount === 1n || amount === -1n ? 'unit' : 'units'}`;

/** An amount of fungible tokens, in raw units. */
export const TokenAmount = ({ amount }: { amount: bigint }) => <span class="token-amount">{rawUnits(amount)}</span>;
