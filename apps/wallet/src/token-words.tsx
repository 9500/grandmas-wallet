import { type ShownRegistry, formatUnits } from '@grandmas-wallet/app';
import { cleanName } from '@grandmas-wallet/core';
import { Info } from '@grandmas-wallet/ui';
import { createContext } from 'preact';

/**
 * How the wallet's screens write an amount of fungible tokens (proposal section 13.3): in raw units, with the category
 * beside it where it is shown; or, where the token's own registry has been checked against the chain, in the token's
 * units with its symbol. That is the issuer's claim: the raw amount and the category stay behind the "?".
 */

/** `12,345 units`, always without a sign. */
export const rawUnits = (amount: bigint): string => `${(amount < 0n ? -amount : amount).toLocaleString('en-US')} ${amount === 1n || amount === -1n ? 'unit' : 'units'}`;

/** `123.45 SYMBOL` with a registry, `12,345 units` without; always without a sign. */
export const tokenUnits = (amount: bigint, names?: ShownRegistry): string => (names === undefined ? rawUnits(amount) : `${formatUnits(amount < 0n ? -amount : amount, names.decimals)} ${names.symbol}`);

/** A token's name as a list shows it: the first line, at most 20 characters. */
export const shortName = (names: ShownRegistry): string => cleanName(names.nftType ?? names.name, 20);

/** What the screens write for a category: the page's registries as kept now. A screen that must not change takes a copy when it opens. */
export const TokenNames = createContext<(category: string, commitment?: string) => ShownRegistry | undefined>(() => undefined);

/**
 * The names as they are known now, for the categories given, and for any other category as it is first asked for: a
 * screen that must not change while it is open (a review) shows these.
 */
export const frozenNames = (live: (category: string, commitment?: string) => ShownRegistry | undefined, categories: string[] = []): ((category: string, commitment?: string) => ShownRegistry | undefined) => {
  const known = new Map<string, ShownRegistry | undefined>();
  const of = (category: string, commitment?: string): ShownRegistry | undefined => {
    const key = `${category}:${commitment ?? ''}`;
    if (!known.has(key)) known.set(key, live(category, commitment));
    return known.get(key);
  };
  for (const category of categories) of(category);
  return of;
};

/** An amount of fungible tokens, in the token's units where its registry is known, else in raw units. */
export const TokenAmount = ({ amount, names }: { amount: bigint; names?: ShownRegistry | undefined }) => <span class="token-amount">{tokenUnits(amount, names)}</span>;

/** The "?" beside a name from a registry: whose claim it is, the full name, the raw amount and the category. */
export const IssuerClaim = ({ names, amount, category }: { names: ShownRegistry; amount?: bigint; category: string }) => (
  <Info label={`About the name ${names.symbol}`}>
    <span>The token's issuer chose this name and published it on the chain. The wallet checked that it is what the issuer published, not that it is true: anyone can make a token and name it.</span>
    <span>Name: {names.nftType === undefined ? names.name : `${names.nftType}, of ${names.name}`}</span>
    {amount !== undefined && amount !== 0n && <span>Raw amount: {rawUnits(amount)}, with {names.decimals === 1 ? 'one decimal' : `${names.decimals} decimals`}.</span>}
    <span>
      Category: <span class="mono">{category}</span>
    </span>
  </Info>
);
