import type { TokenDescription } from './declaration.js';

/**
 * Names of tokens (proposal section 13.3): what the templates the user trusts call the tokens they deal in.
 *
 * A name is a template's claim, not a fact the wallet can check. It is shown only from templates the user
 * trusts, with the template it comes from. No registry and no other source is asked. When two trusted
 * templates name the same tokens differently, the wallet uses neither name and shows the category and the
 * raw units, with what each template says: a name it picked would be a guess, and decimals it picked could
 * show an amount a hundred times too large or too small.
 */

/** The template a name comes from. */
export interface NameSource {
  identifier: string;
  name: string;
}

/** A name that every trusted template that names the tokens agrees on. */
export interface TokenName {
  name: string;
  symbol?: string;
  /** For fungible tokens. */
  decimals?: number;
  /** The templates that give it. */
  from: NameSource[];
}

/** What the wallet can say about the name of some tokens. */
export interface TokenNaming {
  /** Set when one name is given, by one template or by several that agree. */
  named?: TokenName;
  /** Set when trusted templates disagree: what each says. None of it is used. */
  disputed?: (Omit<TokenName, 'from'> & { from: NameSource })[];
}

/** A description as one trusted template gives it. */
export interface NameClaim {
  description: TokenDescription;
  template: NameSource;
}

const sameName = (a: Pick<TokenName, 'name' | 'symbol' | 'decimals'>, b: Pick<TokenName, 'name' | 'symbol' | 'decimals'>): boolean => a.name === b.name && a.symbol === b.symbol && a.decimals === b.decimals;

/** The names the trusted templates give, to be looked up by what the wallet holds. */
export class TokenNames {
  constructor(private readonly claims: NameClaim[]) {}

  /** No template is trusted, or none names anything. */
  static readonly none = new TokenNames([]);

  private naming(claims: NameClaim[]): TokenNaming | undefined {
    const said = claims.map(({ description, template }) => ({
      name: description.name,
      ...(description.symbol === undefined ? {} : { symbol: description.symbol }),
      ...(description.decimals === undefined ? {} : { decimals: description.decimals }),
      from: template,
    }));
    const [first] = said;
    if (first === undefined) return undefined;
    if (said.every((claim) => sameName(claim, first))) {
      const from = said.map((claim) => claim.from).filter((source, index, all) => all.findIndex((other) => other.identifier === source.identifier) === index);
      const { from: _first, ...name } = first;
      return { named: { ...name, from } };
    }
    return { disputed: said };
  }

  /** The name of the fungible tokens of a category. */
  fungible(category: string): TokenNaming | undefined {
    return this.naming(this.claims.filter(({ description }) => description.kind === 'fungible' && description.category === category));
  }

  /**
   * The name of an NFT: from a template that names its category, and from the template whose authority entry
   * the wallet found the token to be (`authority`), whatever its category.
   */
  nft(category: string, authority?: { template: string; entry: string }): TokenNaming | undefined {
    return this.naming(
      this.claims.filter(
        ({ description, template }) =>
          description.kind === 'nft' && (description.category === category || (authority !== undefined && description.authority === authority.entry && template.identifier === authority.template)),
      ),
    );
  }
}

/** An amount of raw units in a token's decimals, grouped by thousands: `10000` with 2 decimals is `100.00`. */
export const formatUnits = (amount: bigint, decimals: number): string => {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toLocaleString('en-US');
  const fraction = decimals === 0 ? '' : `.${(value % scale).toString().padStart(decimals, '0')}`;
  return `${negative ? '−' : ''}${whole}${fraction}`;
};

/** The most a token output can carry. */
export const LARGEST_TOKEN_AMOUNT = 9_223_372_036_854_775_807n;

/**
 * Read an amount a person typed, in a token's decimals (0 for raw units). Nothing is rounded: an amount with
 * more decimals than the token has is refused.
 *
 * @returns the amount in raw units, or the reason it cannot be read
 */
export const parseUnits = (text: string, decimals: number): bigint | string => {
  const cleaned = text.trim().replace(/[,\s_]/g, '');
  if (cleaned === '') return 'Enter an amount.';
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null || (match[1] === '' && (match[2] ?? '') === '')) return decimals === 0 ? 'Enter a whole number.' : 'Enter the amount as a number, for example 12.50.';
  const fraction = match[2] ?? '';
  if (decimals === 0 && match[2] !== undefined && /[1-9]/.test(fraction)) return 'These tokens have no decimals: enter a whole number.';
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    return `These tokens have ${decimals === 1 ? 'one decimal' : `${decimals} decimals`}; the amount has more. Nothing is rounded.`;
  }
  const units = BigInt(match[1] === '' ? '0' : (match[1] as string)) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
  if (units <= 0n) return 'Enter an amount above zero.';
  if (units > LARGEST_TOKEN_AMOUNT) return 'That is more than any token output can carry.';
  return units;
};
