import { type TokenNaming, TokenNames, formatUnits } from '@grandmas-wallet/app';
import { createContext } from 'preact';

/**
 * How the wallet's screens write tokens: a name, a symbol and an amount in the token's decimals only where a
 * template the user trusts gives them, and then with the template's name beside; otherwise raw units and the
 * category. When trusted templates disagree, none of their names is used (proposal section 13.3).
 */

/** The names the trusted templates give, for screens deep in a tree. Without a provider, nothing is named. */
export const TokenNamesContext = createContext<TokenNames>(TokenNames.none);

export const rawUnits = (amount: bigint): string => `${(amount < 0n ? -amount : amount).toLocaleString('en-US')} ${amount === 1n || amount === -1n ? 'unit' : 'units'}`;

/** `123.45 CRD` where a trusted template names the tokens; `12,345 units` otherwise. Always without a sign. */
export const amountText = (amount: bigint, naming: TokenNaming | undefined): string => {
  const named = naming?.named;
  const value = amount < 0n ? -amount : amount;
  return named?.decimals === undefined || named.symbol === undefined ? rawUnits(value) : `${formatUnits(value, named.decimals)} ${named.symbol}`;
};

/** An amount of fungible tokens: in the token's decimals with the raw units small beside, where it is named. */
export const TokenAmount = ({ amount, naming }: { amount: bigint; naming: TokenNaming | undefined }) => {
  const named = naming?.named;
  if (named?.decimals === undefined || named.symbol === undefined) return <span class="token-amount">{rawUnits(amount)}</span>;
  return (
    <span class="token-amount">
      {amountText(amount, naming)} <small class="raw-units">({rawUnits(amount)})</small>
    </span>
  );
};

const quoted = (sources: { name: string }[]): string => sources.map((source) => `"${source.name}"`).join(' and ');

/** Where a name comes from, or that the templates the user trusts disagree about it. */
export const NameSource = ({ naming }: { naming: TokenNaming | undefined }) => {
  if (naming?.named !== undefined) {
    return <span class="small muted name-source">Name from the template {quoted(naming.named.from)}, which you trust. A template's claim, not checked.</span>;
  }
  if (naming?.disputed !== undefined) {
    const said = naming.disputed.map((claim) => `"${claim.name}"${claim.decimals === undefined ? '' : ` with ${claim.decimals} decimals`} (template "${claim.from.name}")`);
    return <span class="small name-source disputed">Templates you trust name these tokens differently: {said.join('; ')}. The wallet uses neither and shows raw units.</span>;
  }
  return null;
};
