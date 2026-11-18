/**
 * The contracts' arithmetic, with their integer division, so that what is built here is what they accept.
 * Debts are in PUSD cents, prices in US cents per BCH, collateral and fees in satoshis.
 */

const SATOSHIS_PER_BCH = 100_000_000n;

/** The smallest debt a loan may have, and the smallest repayment that leaves a loan open: 100.00 PUSD. */
export const MINIMUM_DEBT = 100_00n;

/** The most a loan with this collateral may owe at this price (`Borrowing.cash` 63–67, `manage.cash` 95–99). */
export const maximumDebt = (collateral: bigint, price: bigint): bigint => ((collateral * 10n) / 11n) * price / SATOSHIS_PER_BCH;

/** The least collateral the contracts take for a debt at a price: 110%, to the satoshi. */
export const minimumCollateral = (debt: bigint, price: bigint): bigint => {
  if (price <= 0n) throw new Error('A price is above zero.');
  let collateral = ((debt * SATOSHIS_PER_BCH) / price) * 11n / 10n;
  while (maximumDebt(collateral, price) < debt) collateral += 1n;
  while (collateral > 0n && maximumDebt(collateral - 1n, price) >= debt) collateral -= 1n;
  return collateral;
};

/** The borrowing fee, in satoshis: 0.25% of the debt's value at the price, at least 1,000 (`Borrowing.cash` 98–100). */
export const borrowingFee = (debt: bigint, price: bigint): bigint => {
  const fee = ((debt * SATOSHIS_PER_BCH) / price) * 25n / 10_000n;
  return fee > 1000n ? fee : 1000n;
};

/** The collateral that is worth `percent` of the debt at a price, rounded up. */
export const collateralAtRatio = (debt: bigint, price: bigint, percent: bigint): bigint => {
  const numerator = debt * SATOSHIS_PER_BCH * percent;
  const denominator = price * 100n;
  return (numerator + denominator - 1n) / denominator;
};

/** What the collateral is worth at a price, as a percentage of the debt, to two decimals. */
export const collateralRatio = (collateral: bigint, debt: bigint, price: bigint): number => Number((collateral * price * 10_000n) / (debt * SATOSHIS_PER_BCH)) / 100;

/** The interest one period costs, in satoshis (`payInterest.cash` 72–74); each payment also takes 1,500 for its fee. */
export const interestPerPeriod = (rate: number, debt: bigint, price: bigint): bigint => (BigInt(rate) * ((debt * SATOSHIS_PER_BCH) / price)) / 10_000_000n;

/** What one interest payment takes from the collateral besides the interest: the payment's own fee. */
export const INTEREST_PAYMENT_FEE = 1_500n;

/** Whether a repayment is one the manage function accepts (`manage.cash` 62–69). */
export const repaymentAllowed = (repay: bigint, borrowed: bigint, beingRedeemed: bigint): boolean => {
  const redeemable = borrowed - beingRedeemed;
  return (repay === 0n || repay >= MINIMUM_DEBT || repay === redeemable) && repay <= redeemable && repay >= 0n;
};
