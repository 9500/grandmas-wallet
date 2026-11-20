import { type Output, binToHex, hexToBin } from '@bitauth/libauth';
import { type AccountCoin, type SpendableCoin, ADDRESS_KIND, INPUT_BYTES, InsufficientFundsError, chooseCoins, requiredFee, smallestOutputValue, transactionBytes } from '@grandmas-wallet/core';

import type { HeldToken } from './applications.js';
import type { ReservedAddress, Sent, TokenCoin, WalletParts } from './owner-wallet.js';

/**
 * Sending tokens (proposal section 8): an amount of a fungible token, or one NFT, to an address.
 *
 * - **Fungible tokens.** The wallet gathers coins of the category that carry no NFT, at ordinary addresses of
 *   the current seed, the largest first, until they hold the amount; the rest of their tokens comes back to a
 *   fresh change address.
 * - **An NFT** moves whole: its commitment and capability unchanged, and a fungible amount on the same coin
 *   with it.
 * - **The fee** is paid by the wallet's ordinary coins. A coin that carries a token is spent only when its
 *   tokens move, never to pay. Each token output holds the smallest value an output may hold; what the token
 *   coins held beyond that comes back with the change in Bitcoin Cash.
 *
 * Whether the destination's wallet knows tokens is said by the form its address was written in; the page checks
 * that before anything is asked here. A token at a vault address or at an earlier seed's address is moved to an
 * ordinary address first.
 */

const hex = binToHex;
const sum = (values: bigint[]): bigint => values.reduce((total, value) => total + value, 0n);
const outpointOf = (coin: AccountCoin): string => `${hex(coin.utxo.transactionHash)}:${coin.utxo.index}`;

export type TokenSendRequest =
  /** An amount of a category's fungible tokens, in raw units. */
  | { kind: 'fungible'; category: string; amount: bigint; to: Uint8Array }
  /** The NFT on a coin, by the coin's outpoint, `<transaction id>:<output index>`. */
  | { kind: 'nft'; outpoint: string; to: Uint8Array };

/** What sending tokens will do, worked out as it will be built, before anything is signed. */
export interface TokenSendQuote {
  /** What arrives at the destination: the tokens, and the satoshis under them. */
  sends: { category: string; amount: bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string }; satoshis: bigint };
  /** Fungible tokens that come back to a fresh change address of the wallet. */
  tokenChange?: { category: string; amount: bigint; satoshis: bigint };
  /** Bitcoin Cash that comes back to a fresh change address. */
  changeSatoshis?: bigint;
  feeSatoshis: bigint;
  /** The part of the fee that was too small to come back as change. */
  remainderSatoshis: bigint;
  bytes: number;
  /** The wallet's coins with tokens it spends. */
  tokenCoins: number;
  /** The wallet's ordinary coins that pay. */
  payingCoins: number;
  /** What the wallet's Bitcoin Cash goes down by: the fee and the satoshis under the tokens sent. */
  leavesSatoshis: bigint;
}

/** The tokens cannot be sent as asked, with the reason. Nothing was built. */
export class TokenSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenSendError';
  }
}

const refuse = (message: string): never => {
  throw new TokenSendError(message);
};

interface Plan {
  quote: TokenSendQuote;
  inputs: AccountCoin[];
  outputs: Output[];
  reserved: ReservedAddress[];
  used: ReservedAddress[];
}

const place = (coins: TokenCoin[], where: TokenCoin['place']): bigint => sum(coins.filter((coin) => coin.place === where).map(({ coin }) => coin.utxo.output.token?.amount ?? 0n));

/** Work a send out: the coins, the outputs and the exact fee. Nothing is recorded. */
const plan = async (wallet: WalletParts, request: TokenSendRequest): Promise<Plan> => {
  wallet.requireUsable();
  const coins = await wallet.tokenCoins();
  let gathered: AccountCoin[];
  let sent: NonNullable<Output['token']>;
  let left: bigint | undefined;

  if (request.kind === 'fungible') {
    if (request.amount <= 0n) return refuse('Enter an amount above zero.');
    const category = request.category;
    const ofCategory = coins.filter(({ coin }) => coin.utxo.output.token !== undefined && hex(coin.utxo.output.token.category) === category);
    // Coins that carry an NFT as well move whole, with the NFT; an amount is not taken from them.
    const fungible = ofCategory.filter(({ coin }) => coin.utxo.output.token?.nft === undefined && (coin.utxo.output.token?.amount ?? 0n) > 0n);
    const usable = fungible.filter((coin) => coin.place === 'address').sort((a, b) => ((a.coin.utxo.output.token?.amount ?? 0n) > (b.coin.utxo.output.token?.amount ?? 0n) ? -1 : 1));
    gathered = [];
    let total = 0n;
    for (const { coin } of usable) {
      if (total >= request.amount) break;
      gathered.push(coin);
      total += coin.utxo.output.token?.amount ?? 0n;
    }
    if (total < request.amount) {
      const elsewhere = [
        place(fungible, 'vault') > 0n ? `${place(fungible, 'vault')} at vault addresses, which are moved to an ordinary address first` : '',
        place(fungible, 'earlier') > 0n ? `${place(fungible, 'earlier')} at addresses of an earlier phone, which are moved to this phone's addresses first` : '',
      ].filter((part) => part !== '');
      return refuse(`The wallet holds ${total} units of these tokens where it can send them, less than the ${request.amount} asked for.${elsewhere.length === 0 ? '' : ` It holds ${elsewhere.join(', and ')}.`}`);
    }
    sent = { category: hexToBin(category), amount: request.amount };
    left = total - request.amount;
  } else {
    const held = coins.find(({ coin }) => outpointOf(coin) === request.outpoint);
    if (held === undefined || held.coin.utxo.output.token?.nft === undefined) return refuse('The wallet holds no such token. It may have been sent a moment ago.');
    if (held.place === 'vault') return refuse('The token is at a vault address. It is moved to an ordinary address of the wallet first.');
    if (held.place === 'earlier') return refuse('The token is at an address of an earlier phone, where that phone could still move it. It is moved to this phone\'s addresses first.');
    gathered = [held.coin];
    sent = held.coin.utxo.output.token;
    left = undefined;
  }

  // A fresh change address for the tokens left over, and one for the change in Bitcoin Cash.
  const withTokenChange = left !== undefined && left > 0n;
  const reserved = wallet.reserve(withTokenChange ? [ADDRESS_KIND.change, ADDRESS_KIND.change] : [ADDRESS_KIND.change]);
  const tokenChangeAt = withTokenChange ? reserved[0] : undefined;
  const changeAt = reserved.at(-1) as ReservedAddress;
  const smallest = (output: Output): Output => ({ ...output, valueSatoshis: smallestOutputValue(output) });
  const sendOutput = smallest({ lockingBytecode: request.to, valueSatoshis: 0n, token: sent });
  const tokenOutputs = [sendOutput, ...(tokenChangeAt === undefined ? [] : [smallest({ lockingBytecode: tokenChangeAt.address.lockingBytecode, valueSatoshis: 0n, token: { category: sent.category, amount: left as bigint } })])];

  // The fee from the ordinary coins: what the token coins hold beyond their outputs comes back as change, and
  // is set as an output of its own before the coins are chosen, so that none of it can pay.
  const own = await wallet.ownCoins();
  const available: (SpendableCoin & { coin: AccountCoin })[] = own.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.byKey, coin }));
  const fixedInputs: SpendableCoin[] = gathered.map((coin) => ({ utxo: coin.utxo, inputBytes: INPUT_BYTES.byKey }));
  const tokenIn = sum(gathered.map((coin) => coin.utxo.output.valueSatoshis));
  const tokenOut = sum(tokenOutputs.map((output) => output.valueSatoshis));
  const surplus = tokenIn - tokenOut;
  const changeLockingBytecode = changeAt.address.lockingBytecode;
  const leastChange = smallestOutputValue({ lockingBytecode: changeLockingBytecode, valueSatoshis: 0n });
  const back: Output[] = surplus > 0n ? [{ lockingBytecode: changeLockingBytecode, valueSatoshis: surplus > leastChange ? surplus : leastChange }] : [];
  let choice: ReturnType<typeof chooseCoins>;
  try {
    choice = chooseCoins({ available, fixedInputs, outputs: [...tokenOutputs, ...back], changeLockingBytecode, feeRate: wallet.feeRate });
  } catch (error) {
    if (!(error instanceof InsufficientFundsError)) throw error;
    // In the figures of the ordinary coins alone: what they hold, and what they would have to.
    throw new InsufficientFundsError(
      error.totalSatoshis - tokenIn,
      error.feeSatoshis,
      error.neededSatoshis - tokenIn,
      'the wallet\'s Bitcoin Cash does not cover the fee of sending the tokens. The fee never comes from a coin that carries a token; a little Bitcoin Cash has to arrive first.',
    );
  }
  const payers = choice.coins.map(({ utxo }) => (available.find((entry) => entry.utxo === utxo) as (typeof available)[number]).coin);
  const inputs = [...gathered, ...payers];
  let outputs: Output[];
  let feeSatoshis: bigint;
  let remainderSatoshis: bigint;
  let bytes: number;
  if (back.length > 0) {
    // The change chosen, and what the token coins brought, in one output at the exact fee.
    const total = sum(inputs.map((coin) => coin.utxo.output.valueSatoshis));
    bytes = transactionBytes(inputs.map(() => INPUT_BYTES.byKey), [...tokenOutputs, ...back]);
    feeSatoshis = requiredFee(bytes, wallet.feeRate);
    remainderSatoshis = 0n;
    outputs = [...tokenOutputs, { lockingBytecode: changeLockingBytecode, valueSatoshis: total - tokenOut - feeSatoshis }];
  } else {
    bytes = choice.bytes;
    feeSatoshis = choice.feeSatoshis;
    remainderSatoshis = choice.remainderSatoshis;
    outputs = [...tokenOutputs, ...(choice.changeSatoshis === undefined ? [] : [{ lockingBytecode: changeLockingBytecode, valueSatoshis: choice.changeSatoshis }])];
  }
  const changeSatoshis = outputs.length > tokenOutputs.length ? (outputs.at(-1) as Output).valueSatoshis : undefined;
  const tokenChangeOutput = tokenOutputs[1];
  return {
    quote: {
      sends: {
        category: hex(sent.category),
        amount: sent.amount,
        ...(sent.nft === undefined ? {} : { nft: { capability: sent.nft.capability, commitment: hex(sent.nft.commitment) } }),
        satoshis: sendOutput.valueSatoshis,
      },
      ...(tokenChangeOutput === undefined ? {} : { tokenChange: { category: hex(sent.category), amount: left as bigint, satoshis: tokenChangeOutput.valueSatoshis } }),
      ...(changeSatoshis === undefined ? {} : { changeSatoshis }),
      feeSatoshis,
      remainderSatoshis,
      bytes,
      tokenCoins: gathered.length,
      payingCoins: payers.length,
      leavesSatoshis: sendOutput.valueSatoshis + feeSatoshis,
    },
    inputs,
    outputs,
    reserved,
    used: [...(tokenChangeAt === undefined ? [] : [tokenChangeAt]), ...(changeSatoshis === undefined ? [] : [changeAt])],
  };
};

/**
 * What sending tokens will do and cost, before the user approves. Nothing is recorded.
 *
 * @throws TokenSendError when it cannot be done as asked; InsufficientFundsError, in the figures of the ordinary coins, when they do not cover the fee
 */
export const quoteTokenSend = async (wallet: WalletParts, request: TokenSendRequest): Promise<TokenSendQuote> => (await plan(wallet, request)).quote;

/**
 * Send tokens: the user has approved the quote. The send is worked out again, as the quote was.
 *
 * @throws as `quoteTokenSend`
 */
export const sendTokens = async (wallet: WalletParts, request: TokenSendRequest): Promise<{ sent: Sent; quote: TokenSendQuote }> => {
  const planned = await plan(wallet, request);
  await wallet.hold(planned.reserved);
  let prepared;
  try {
    prepared = await wallet.prepare({ template: 'actions', action: 'pay', role: 'owner', inputs: planned.inputs.map((coin) => ({ coin })), outputs: planned.outputs });
  } catch (error) {
    // Nothing was signed: the addresses may be used for something else.
    wallet.giveBack(planned.reserved);
    throw error;
  }
  try {
    await wallet.send(prepared);
  } finally {
    // Whether or not the network took it, a signature that names these addresses has left the wallet.
    wallet.keep(planned.used);
    wallet.giveBack(planned.reserved.filter((entry) => !planned.used.includes(entry)));
  }
  return { sent: { transactionId: prepared.transactionId, bytes: prepared.bytes, feeSatoshis: prepared.feeSatoshis, remainderSatoshis: planned.quote.remainderSatoshis }, quote: planned.quote };
};

// ------------------------------------------------------------------ what can be sent

/** A token as the send screen offers it: a category's fungible tokens together, or one NFT. */
export type SendableToken =
  | {
      kind: 'fungible';
      /** `fungible:<category>`. */
      key: string;
      category: string;
      /** At ordinary addresses of this seed: what can be sent now. */
      amount: bigint;
      /** In how many coins. */
      coins: number;
      /** Elsewhere: moved to an ordinary address before it can be sent. */
      vault: bigint;
      earlier: bigint;
      /** On coins that carry an NFT as well, which move whole with their NFT. */
      withNfts: bigint;
    }
  | {
      kind: 'nft';
      /** `nft:<outpoint>`. */
      key: string;
      token: HeldToken;
    };

/**
 * The tokens the wallet holds, as the send screen offers them: each category's fungible tokens as one balance,
 * then each NFT on its own.
 */
export const sendableTokens = (held: HeldToken[]): SendableToken[] => {
  const fungible = new Map<string, Extract<SendableToken, { kind: 'fungible' }>>();
  for (const token of held) {
    if (token.amount === 0n) continue;
    const entry = fungible.get(token.category) ?? { kind: 'fungible' as const, key: `fungible:${token.category}`, category: token.category, amount: 0n, coins: 0, vault: 0n, earlier: 0n, withNfts: 0n };
    if (token.capability !== undefined) entry.withNfts += token.amount;
    else if (token.place === 'address') {
      entry.amount += token.amount;
      entry.coins += 1;
    } else if (token.place === 'vault') entry.vault += token.amount;
    else entry.earlier += token.amount;
    fungible.set(token.category, entry);
  }
  const nfts = held.filter((token) => token.capability !== undefined).map((token): SendableToken => ({ kind: 'nft', key: `nft:${token.outpoint}`, token }));
  return [...[...fungible.values()].filter((entry) => entry.amount + entry.vault + entry.earlier > 0n), ...nfts];
};

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
