import { binToHex, flattenBinArray, hexToBin } from '@bitauth/libauth';

/**
 * The states the contracts keep in NFT commitments, as `Borrowing.cash`, `Loan.cash` and the price contract
 * write them. Numbers are script numbers padded to a fixed width (`toPaddedBytes`), read back with `int()`.
 */

/** A non-negative number as `toPaddedBytes(value, length)` writes it. */
export const paddedNumber = (value: bigint, length: number): Uint8Array => {
  if (value < 0n || value >= 1n << BigInt(8 * length - 1)) throw new Error(`${value} does not fit ${length} bytes as a script number.`);
  return Uint8Array.from({ length }, (_, index) => Number((value >> BigInt(8 * index)) & 0xffn));
};

/** Bytes read as a number, as `int(bytes)` does: little-endian, the sign in the highest bit of the last byte. */
export const readNumber = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[index] as number);
  if (bytes.length > 0 && ((bytes[bytes.length - 1] as number) & 0x80) !== 0) {
    value &= ~(0x80n << BigInt(8 * (bytes.length - 1)));
    value = -value;
  }
  return value;
};

/** How a loan's interest may be changed: by its own key only (`none`), or by a delegate within limits. */
export interface InterestManagerConfiguration {
  /** 0: no interest manager. */
  manager: number;
  minimumRate: number;
  maximumRate: number;
}

/** What Paryon's own front end gives a new loan: no manager, any rate from 0 to 32,767. */
export const NO_INTEREST_MANAGER: InterestManagerConfiguration = { manager: 0, minimumRate: 0, maximumRate: 32_767 };

export const encodeInterestManagerConfiguration = (configuration: InterestManagerConfiguration): Uint8Array =>
  flattenBinArray([Uint8Array.of(configuration.manager), paddedNumber(BigInt(configuration.minimumRate), 2), paddedNumber(BigInt(configuration.maximumRate), 2)]);

/** An interest rate as the contracts take it: two bytes, per 10,000,000 per period. */
export const encodeInterestRate = (rate: number): Uint8Array => paddedNumber(BigInt(rate), 2);

/** A loan's state: the 27-byte commitment of its mutable NFT (`Loan.cash`). */
export interface LoanState {
  /** The debt, in PUSD cents. */
  borrowed: bigint;
  /** The part of the debt a redemption is taking; nothing can be repaid or withdrawn against it. */
  beingRedeemed: bigint;
  /** 0 new, 1 one period, 2 mature: counted up by interest payments. */
  status: number;
  /** The last period interest was paid for; at borrowing, the period of the Borrowing thread used. */
  lastPeriodInterestPaid: number;
  currentInterestRate: number;
  nextInterestRate: number;
  interestManager: InterestManagerConfiguration;
}

const LOAN_STATE_LENGTH = 27;

export const encodeLoanState = (state: LoanState): Uint8Array =>
  flattenBinArray([
    Uint8Array.of(0x01),
    paddedNumber(state.borrowed, 6),
    paddedNumber(state.beingRedeemed, 6),
    Uint8Array.of(state.status),
    paddedNumber(BigInt(state.lastPeriodInterestPaid), 4),
    encodeInterestRate(state.currentInterestRate),
    encodeInterestRate(state.nextInterestRate),
    encodeInterestManagerConfiguration(state.interestManager),
  ]);

export const decodeLoanState = (commitment: Uint8Array): LoanState => {
  if (commitment.length !== LOAN_STATE_LENGTH || commitment[0] !== 0x01) throw new Error(`Not a loan's state: ${binToHex(commitment)}`);
  const at = (start: number, end: number): bigint => readNumber(commitment.slice(start, end));
  return {
    borrowed: at(1, 7),
    beingRedeemed: at(7, 13),
    status: commitment[13] as number,
    lastPeriodInterestPaid: Number(at(14, 18)),
    currentInterestRate: Number(at(18, 20)),
    nextInterestRate: Number(at(20, 22)),
    interestManager: { manager: commitment[22] as number, minimumRate: Number(at(23, 25)), maximumRate: Number(at(25, 27)) },
  };
};

/** The state a new loan gets (`Borrowing.cash` line 81). */
export const newLoanState = (borrowed: bigint, periodBorrowing: number, startingInterest: number, interestManager: InterestManagerConfiguration): LoanState => ({
  borrowed,
  beingRedeemed: 0n,
  status: 0,
  lastPeriodInterestPaid: periodBorrowing,
  currentInterestRate: startingInterest,
  nextInterestRate: startingInterest,
  interestManager,
});

/** A price thread's state: `00`, the oracle message's content sequence and the price in US cents per BCH. */
export interface PriceState {
  sequence: number;
  /** US cents per BCH. */
  price: bigint;
}

export const decodePriceState = (commitment: Uint8Array): PriceState => {
  if (commitment.length !== 9 || commitment[0] !== 0x00) throw new Error(`Not a price contract's state: ${binToHex(commitment)}`);
  return { sequence: Number(readNumber(commitment.slice(1, 5))), price: readNumber(commitment.slice(5, 9)) };
};

/** A Borrowing thread's state: the period its new loans start in. */
export const decodeBorrowingPeriod = (commitment: Uint8Array): number => Number(readNumber(commitment));
export const encodeBorrowingPeriod = (period: number): Uint8Array => paddedNumber(BigInt(period), 4);

/** The commitment of a loan's sidecar NFT. */
export const SIDECAR_COMMITMENT = Uint8Array.of(0x01);
/** The commitment of the manage function's NFT. */
export const MANAGE_FUNCTION_COMMITMENT = Uint8Array.of(0x02);
/** The data output a repayment and a closing burn tokens to: `OP_RETURN` alone. */
export const BURN_LOCKING_BYTECODE = hexToBin('6a');
