import { hexToBin } from '@bitauth/libauth';
import { type BorrowingThread, type PriceThread, CHIPNET_FAST_PERIODS_6, MAINNET_V1, borrowingFee, collateralRatio, decodePriceState, minimumCollateral, paryonChipnetTemplateText, paryonMainnetTemplateText } from '@grandmas-wallet/paryon';
import { describe, expect, it } from 'vitest';

import {
  CHIPNET_DESK,
  DEFAULT_PERCENT,
  MAINNET_DESK,
  SAFE_PERCENT,
  collateralPercents,
  deskFor,
  liquidationPrice,
  borrowPlan,
  borrowingFor,
  collateralProblem,
  finalLockHeight,
  formatPrice,
  formatPusd,
  interestEachPeriod,
  interestRateProblem,
  lowerPrice,
  parsePercent,
  parsePusd,
  partRepayment,
  periodNeed,
  periodOf,
  periodsPerYear,
  priceBasis,
  repaymentProblem,
  yearlyPercent,
} from '../src/loan.js';

/** The loan page's own arithmetic and rules, without a chain or a wallet. */

const thread = (period: number, supply: bigint, index = 0): BorrowingThread => ({ transactionHash: new Uint8Array(32).fill(index), index: 0, height: 1, output: { lockingBytecode: Uint8Array.of(0x51), valueSatoshis: 1_000n }, period, supply });
const priceAt = (price: bigint): PriceThread => {
  const commitment = hexToBin(`00a0f21c00${Array.from({ length: 4 }, (_, index) => Number((price >> BigInt(8 * index)) & 0xffn).toString(16).padStart(2, '0')).join('')}`);
  return { transactionHash: new Uint8Array(32), index: 0, height: 1, output: { lockingBytecode: Uint8Array.of(0x51), valueSatoshis: 1_000n }, state: decodePriceState(commitment) };
};
const STORED = 27_498n;
const ORACLE = 20_867n;
const market = { lower: lowerPrice(STORED, ORACLE), priceThread: priceAt(STORED) };
const loanWith = (debt: bigint, collateral: bigint) => ({
  debt,
  beingRedeemed: 0n,
  found: { loan: { transactionHash: new Uint8Array(32), index: 2, height: 1, output: { lockingBytecode: Uint8Array.of(0x51), valueSatoshis: collateral } }, sidecar: undefined as never, state: undefined as never, keyCategory: new Uint8Array(32) },
});

describe('amounts as typed and shown', () => {
  it('reads PUSD in dollars and cents, and refuses what is not an amount', () => {
    expect(parsePusd('100')).toBe(100_00n);
    expect(parsePusd('$1,250.5')).toBe(1_250_50n);
    expect(parsePusd('0.01')).toBe(1n);
    expect(parsePusd('1.234')).toMatch(/at most two decimal places/);
    expect(parsePusd('0')).toMatch(/above zero/);
    expect(parsePusd('')).toMatch(/Enter an amount/);
    expect(formatPusd(100_00n)).toBe('100.00');
    expect(formatPusd(1_234_567n)).toBe('12,345.67');
    expect(formatPrice(20_867n)).toBe('$208.67');
    expect(parsePercent('125%')).toBe(125);
    expect(parsePercent('12.5')).toMatch(/whole number/);
  });
});

describe('heights and periods', () => {
  it('on chipnet, a lock time by height is reckoned at ten-minute blocks, as the network\'s nodes take it, with one block in hand', () => {
    // The owner's node, 18 November 2026: 336374 blocks, 199705440 ticks, so heights up to 332842 are final.
    expect(finalLockHeight('chipnet', 336_374)).toBe(332_841);
    expect(finalLockHeight('chipnet', 332_450)).toBe(332_449);
    expect(finalLockHeight('mainnet', 900_000)).toBe(899_999);
    expect(periodOf(332_841)).toBe(Math.floor((332_841 - 301_978) / 3));
  });

  it('asks to bring the contracts up to date only when the freshest one that can lend is more than one period behind', () => {
    const threads = [thread(9_139, 9n * 10n ** 17n, 1), thread(10_283, 5n * 10n ** 17n, 2), thread(10_283, 10_000n, 3)];
    expect(borrowingFor(threads, 100_00n)?.supply).toBe(5n * 10n ** 17n);
    expect(periodNeed({ borrowing: threads, period: 10_284 })).toMatchObject({ needed: false, thread: { period: 10_283 } });
    const need = periodNeed({ borrowing: threads, period: 10_290 });
    // The one moved on is the one that can still lend the most; at most a fee for each missed period could fall on a loan otherwise.
    expect(need).toMatchObject({ needed: true, thread: { period: 9_139 }, behind: 1_151, atMost: 1_151n * 1_500n });
    expect(periodNeed({ borrowing: [thread(10_283, 50_00n)], period: 10_290 })).toMatchObject({ needed: 'impossible' });
  });
});

describe('borrowing', () => {
  it('reckons collateral at the lower of the stored price and the oracle\'s, 125% by default, with Paryon\'s fee at the stored price', () => {
    expect(market.lower).toBe(ORACLE);
    const plan = borrowPlan(100_00n, DEFAULT_PERCENT, market);
    expect(plan.problem).toBeUndefined();
    expect(plan.collateral).toBe(59_903_197n);
    expect(collateralRatio(plan.collateral, 100_00n, ORACLE)).toBe(125);
    expect(plan.ratioAtStored).toBeGreaterThan(160);
    expect(plan.fee).toBe(borrowingFee(100_00n, STORED));
    expect(plan.total).toBe(plan.collateral + plan.fee + 2_000n);
  });

  it('refuses a debt below 100.00 PUSD and a collateral below the safe ratio', () => {
    expect(borrowPlan(99_99n, DEFAULT_PERCENT, market).problem).toMatch(/at least 100\.00 PUSD/);
    expect(borrowPlan(100_00n, SAFE_PERCENT - 1, market).problem).toMatch(/less than 115%/);
    expect(borrowPlan(100_00n, SAFE_PERCENT, market).problem).toBeUndefined();
    // With the oracle above the stored price, the stored price is the lower one.
    expect(borrowPlan(100_00n, SAFE_PERCENT, { lower: lowerPrice(STORED, 30_000n), priceThread: priceAt(STORED) }).collateral).toBeGreaterThanOrEqual(minimumCollateral(100_00n, STORED));
  });

  it('names the price it reckons with as the deployment has it: the lower of two, or the stored one where no oracle is read', () => {
    expect(priceBasis(undefined)).toEqual({ short: 'the lower price', explained: 'The lower of the stored price and the oracle\'s' });
    expect(priceBasis(false).short).toBe('the lower price');
    expect(borrowPlan(100_00n, SAFE_PERCENT - 1, market).problem).toMatch(/115% collateral at the lower price\./);
    // A deployment on a chain of one's own: the stored price alone, and nothing said of an oracle.
    const alone = { lower: STORED, priceThread: priceAt(STORED), withoutOracle: true as const };
    expect(priceBasis(alone.withoutOracle)).toEqual({ short: 'the stored price', explained: 'The stored price; no oracle is read here' });
    expect(borrowPlan(100_00n, SAFE_PERCENT - 1, alone).problem).toMatch(/115% collateral at the stored price\./);
    expect(collateralRatio(borrowPlan(100_00n, DEFAULT_PERCENT, alone).collateral, 100_00n, STORED)).toBe(125);
  });
});

describe('managing a loan', () => {
  it('offers a part repayment only where at least 100.00 PUSD is repaid and 100.00 left', () => {
    expect(partRepayment({ debt: 100_00n })).toBeUndefined();
    expect(partRepayment({ debt: 199_99n })).toBeUndefined();
    expect(partRepayment({ debt: 200_00n })).toEqual({ smallest: 100_00n, largest: 100_00n });
    expect(partRepayment({ debt: 350_00n, beingRedeemed: 20_00n })).toEqual({ smallest: 100_00n, largest: 230_00n });
    expect(repaymentProblem({ debt: 100_00n }, 50_00n)).toMatch(/too small to repay in part/);
    expect(repaymentProblem({ debt: 350_00n }, 99_99n)).toMatch(/between 100\.00 and 250\.00/);
    expect(repaymentProblem({ debt: 350_00n }, 250_01n)).toMatch(/between/);
    expect(repaymentProblem({ debt: 350_00n }, 250_00n)).toBeUndefined();
  });

  it('lets collateral be added, and taken out only while the loan stays at the safe ratio at the lower price', () => {
    const loan = loanWith(100_00n, 59_903_197n);
    expect(collateralProblem(loan, 60_003_197n, market)).toBeUndefined();
    expect(collateralProblem(loan, 59_903_197n, market)).toMatch(/holds now/);
    const safe = (100_00n * 100_000_000n * 115n + ORACLE * 100n - 1n) / (ORACLE * 100n);
    expect(collateralProblem(loan, safe, market)).toBeUndefined();
    expect(collateralProblem(loan, safe - 1_000n, market)).toMatch(/115% or more/);
  });
});

describe('the interest rate', () => {
  it('takes a whole number from 0 to 32,767, per 10,000,000 per period', () => {
    expect(interestRateProblem(0)).toBeUndefined();
    expect(interestRateProblem(32_767)).toBeUndefined();
    for (const rate of [-1, 32_768, 1.5, Number.NaN]) expect(interestRateProblem(rate)).toMatch(/from 0 to 32,767/);
  });

  it('gives a rate as a share of the debt in a year, as Paryon does: on mainnet a period is a day, and 1,096 is 4.0%; on chipnet a period is half an hour', () => {
    expect(periodsPerYear(MAINNET_V1)).toBe(365);
    expect(yearlyPercent(1_096, MAINNET_V1)).toBeCloseTo(4.0, 1);
    expect(yearlyPercent(1_699, MAINNET_V1)).toBeCloseTo(6.2, 1);
    expect(periodsPerYear(CHIPNET_FAST_PERIODS_6)).toBe(17_520);
  });

  it('says what a rate costs each period, in satoshis from the collateral, as Paryon\'s interest payment reckons it', () => {
    // 200.00 PUSD at $198.49: 100,760,743 satoshis of value; 100 per 10,000,000 of it.
    expect(interestEachPeriod(100, 200_00n, 19_849n)).toBe(1_007n);
    expect(interestEachPeriod(0, 200_00n, 19_849n)).toBe(0n);
  });
});

describe('on mainnet', () => {
  it('uses Paryon\'s deployment mainnet-v1 and its own template, version 2 as on chipnet, whose oracle is the one read on chipnet', () => {
    expect(deskFor({ network: 'mainnet' })).toBe(MAINNET_DESK);
    expect(MAINNET_DESK.deployment.name).toBe('mainnet-v1');
    expect(MAINNET_DESK.paryons).toBe(true);
    expect(MAINNET_DESK.template.names.identifier).toBe('30647ea4b817c4e58b32fb4fc104643af9c1e92295729b33d5551dc875569364');
    expect(CHIPNET_DESK.template.names.identifier).toBe('3fa4baf9f313ee2a5046ae30fdf1f7affc6aca21a29e3f6b38227b4a826e9235');
    expect(MAINNET_DESK.template.texts.template).toBe(paryonMainnetTemplateText);
    expect(CHIPNET_DESK.template.texts.template).toBe(paryonChipnetTemplateText);
    // The page reads General Protocols' oracle with chipnet's deployment; the key is the same on mainnet.
    expect(MAINNET_DESK.deployment.oraclePublicKey).toBe(CHIPNET_DESK.deployment.oraclePublicKey);
  });

  it('proposes 150% collateral and takes no less than 130%; on test networks 125% and 115%', () => {
    expect(collateralPercents('mainnet')).toEqual({ proposed: 150, least: 130 });
    expect(collateralPercents('chipnet')).toEqual({ proposed: DEFAULT_PERCENT, least: SAFE_PERCENT });
    const market = { lower: 19_383n, priceThread: priceAt(19_383n) };
    expect(borrowPlan(100_00n, 129, market, 130).problem).toMatch(/less than 130% collateral/);
    expect(borrowPlan(100_00n, 130, market, 130).problem).toBeUndefined();
    // Not even at the contracts' line, which the contracts themselves would take.
    expect(borrowPlan(100_00n, 110, market, 130).problem).toMatch(/limit of 110%, where it can be liquidated/);
  });

  it('says what the smallest loan needs at the day\'s price: about 0.57 BCH at the line, 0.77 at 150%', () => {
    const price = 19_383n;
    expect(borrowPlan(100_00n, 110, { lower: price, priceThread: priceAt(price) }, 100).collateral).toBe(56_750_761n);
    // The contracts' own least, one satoshi more for their rounding.
    expect(minimumCollateral(100_00n, price)).toBe(56_750_762n);
    expect(borrowPlan(100_00n, 150, { lower: price, priceThread: priceAt(price) }, 130).collateral).toBe(77_387_402n);
    expect(borrowingFee(100_00n, price)).toBe(128_979n);
    // At 150% the loan reaches the line when BCH falls to about $142.14, some 27% lower.
    expect(liquidationPrice(77_387_402n, 100_00n)).toBe(14_215n);
    expect(collateralRatio(77_387_402n, 100_00n, 14_215n)).toBeGreaterThanOrEqual(110);
    expect(collateralRatio(77_387_402n, 100_00n, 14_214n)).toBeLessThan(110);
  });
});

