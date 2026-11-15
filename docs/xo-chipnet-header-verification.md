# Block header verification fails on chipnet after the switch to one-minute blocks

**Packages:** `@electrum-cash/application` 0.5.2-development.16863504490 and `@electrum-cash/checkpoint` 0.7.2, as used by `@xo-cash/engine` 0.1.1-next.18029697917
**Network:** chipnet
**Found:** 15 November 2026

## Summary

Chipnet activated CHIP-2025-03 (one-minute blocks) on 15 November 2026. From the first block under the new rules, height 332451, header verification rejects every header, so the verified height stays just below it while the chain moves on. An engine on chipnet then logs an error for every transaction confirmed after that height.

Unspent outputs are still listed and transactions can still be built and broadcast, so the effect is easy to miss.

## Symptoms

- Repeated in the log:
  `Failed to synchronize block headers, will retry later: Error: Header '00000000000ecc7187034ddaa4327af300c23fd57bfd2557af6ca2392a022671' at height 332451 claims target 486604799, expected 437753688.`
- For every transaction confirmed above that height:
  `Failed to process transaction update: Error: Could not validate a block header on height N: The requested header is ahead of the current checkpoint at height M`
- `engine.getChainStatus()` reports a `verifiedHeight` that no longer follows `currentHeight`.

## Steps to reproduce

1. `Engine.create(mnemonic, { network: XO_SUPPORTED_NETWORKS.chipnet })`.
2. Poll `engine.getChainStatus()` for a minute. `verifiedHeight` stops below 332451.
3. Track any script with a transaction confirmed after height 332451 and watch the log.

## Cause

`calculateAsertTarget` in `source/blockchain/difficulty/asert.ts` assumes one ideal block time for the whole chain, and the chipnet parameters in `@electrum-cash/checkpoint` set it to 600 seconds. Under the new rules the ideal block time is 60 seconds from the activation on, which changes two things:

1. **The minimum-difficulty exception on test networks.** A block may claim minimum difficulty when it is more than twice the ideal block time after its parent. That is 120 seconds after the activation, not 1200. Block 332451 came 160 seconds after its parent and claims minimum difficulty; the current code expects a regular target.
2. **The target itself.** The schedule is no longer counted in blocks but in "ticks", the sum of the ideal block times of all blocks so far, and the result is multiplied by the ratio of the anchor's block time to the current one.

## The rule chipnet follows

Taken from the source the chipnet node is built from: Bitcoin Cash Node merge request !2184, "Implement CHIP-2025-03 Faster Blocks for Bitcoin Cash" (branch `blocktime/proposed1`, commit `6f12f6a`), files `src/chainparams.cpp`, `src/consensus/consensus.h`, `src/consensus/activation.cpp` and `src/pow.cpp`. The node's master branch does not contain it yet.

| Parameter (chipnet) | Value | Source |
| --- | --- | --- |
| Activation time | 1794744000 (2026-11-15 12:00:00 UTC) | `upgrade2027ActivationTime` in `CChipNetParams` |
| When a block is under the new rules | its parent's median time past is at or after the activation time | `IsUpgrade2027Enabled`, `GetPowTargetSpacing` |
| First block under the new rules | height 332451 | derived from the headers |
| Ideal block time | 600 s before, 60 s from that block on | `legacy::POW_TARGET_SPACING_TICKS`, `upgrade2027::POW_TARGET_SPACING_TICKS` |
| ASERT anchor | unchanged: height 16844, bits `0x1d00ffff`, previous block time 1605451779, mined at a 600 s interval | `asertAnchorParams` |
| Half-life | unchanged: 3600 s | `nASERTHalfLife` |

For a block at height `h` with parent `h - 1`:

```
interval(h) = 60 if h >= 332451, otherwise 600
ticks(h)    = sum of interval(i) for i = 1..h

if minimum difficulty is allowed and time(h) > time(h - 1) + 2 * interval(h):
    target = minimum difficulty target
else:
    exponent = (time(h - 1) - anchor previous time) - (ticks(h - 1) - ticks(anchor) + 600)
    target   = anchor target * 2^(exponent / half-life) * (600 / interval(h))
    target   = min(target, minimum difficulty target)
```

The fixed-point arithmetic for `2^x` is unchanged; the multiplication by `600 / interval(h)` comes after it and before the clamp. Before the activation every block adds 600 ticks and the ratio is 1, so the result is identical to the current code.

## How the rule was checked

The rule above was implemented independently and compared with headers from a chipnet node: 24 blocks around the activation and the 300 blocks up to the tip at the time (height 333059). All 324 claimed targets matched, including the minimum-difficulty blocks on both sides of the activation. The script is `spikes/xo-engine/16-chipnet-difficulty.ts` in this repository.

A few of the values:

| Height | Seconds after parent | Claimed bits | Rule gives |
| --- | --- | --- | --- |
| 332450 | 29 | `1a1a55f5` | `1a1a55f5` |
| 332451 | 160 | `1d00ffff` | `1d00ffff` (minimum difficulty; first block under the new rules) |
| 332452 | 63 | `1b00f080` | `1b00f080` |
| 332453 | 44 | `1b00f0a4` | `1b00f0a4` |
| 332454 | 124 | `1d00ffff` | `1d00ffff` (minimum difficulty) |

## Suggested fix

### `@electrum-cash/checkpoint`, `source/chipnet.ts`

Add the point where the ideal block time changes to chipnet's difficulty parameters. The field name is only a suggestion:

```ts
difficultyParameters:
{
	// ...existing fields...
	asertIdealBlockTimeInSeconds: 600,

	// One-minute blocks (CHIP-2025-03) from the first block whose parent's median time past reached 1794744000.
	idealBlockTimeChange:
	{
		firstBlockHeight: 332451,
		idealBlockTimeInSeconds: 60,
	},
},
```

### `@electrum-cash/application`, `source/blockchain/difficulty/asert.ts`

In `calculateAsertTarget`, take the ideal block time per height, count the schedule in ticks, and scale the result:

```ts
const { idealBlockTimeChange } = difficultyParameters;

// The ideal block time that applies to a block at the given height.
const idealBlockTimeAt = (height: number): number =>
	(idealBlockTimeChange !== undefined && height >= idealBlockTimeChange.firstBlockHeight)
		? idealBlockTimeChange.idealBlockTimeInSeconds
		: asertIdealBlockTimeInSeconds;

// The sum of the ideal block times of all blocks up to and including the given height.
const ticksAt = (height: number): number =>
	(idealBlockTimeChange === undefined || height < idealBlockTimeChange.firstBlockHeight)
		? height * asertIdealBlockTimeInSeconds
		: ((idealBlockTimeChange.firstBlockHeight - 1) * asertIdealBlockTimeInSeconds)
			+ ((height - idealBlockTimeChange.firstBlockHeight + 1) * idealBlockTimeChange.idealBlockTimeInSeconds);

// Minimum-difficulty exception: twice the ideal block time of the block being checked.
const requiredDurationToResetDifficulty = 2 * idealBlockTimeAt(blockHeight);

// Time the chain should have taken from the anchor to the parent, plus one anchor interval.
const expectedTimeInSeconds = ticksAt(blockHeight - 1) - ticksAt(asertAnchoredBlockHeight) + asertIdealBlockTimeInSeconds;

// ...exponent, shifts and the cubic approximation as before...

// A shorter ideal block time than the anchor's raises the target by the same ratio.
nextTarget *= BigInt(asertIdealBlockTimeInSeconds / idealBlockTimeAt(blockHeight));

// ...clamp to the minimum difficulty target as before...
```

### Points to decide

- **A constant height or the activation rule.** For chipnet the first block is known, so a constant is enough and is how node software records past upgrades. Mainnet is scheduled to activate by median time past in May 2027; handling that before it happens means deriving the activation from the eleven headers before each block.
- **Other places that assume 600 seconds.** `synchronizeBlockHeaders` sizes its requests with `HEADER_SYNCHRONIZATION_WINDOW_IN_SECONDS / 600`. It only affects batch size, but it will ask for ten times fewer headers than intended after the activation.
- **Testnet4** shares chipnet's anchor but has not activated the change, so its parameters stay as they are.

## Result of the fix

The change was applied to the installed builds (`dist/index.mjs` of both packages) and run against chipnet:

| | Before | After |
| --- | --- | --- |
| Verified height | stops just below 332451 (332431 when observed) | reaches the tip about 10 seconds after start |
| New blocks | not verified | verified as they arrive (followed for three minutes, five new blocks) |
| Errors logged while listing an account's outputs | 48 | 0, when the listing starts after verification has reached the tip |

The script that applies or reverts the change is `spikes/xo-engine/patches/chipnet-faster-blocks.mjs` in this repository.

## A related observation

With the fix applied, the same "Could not validate a block header … ahead of the current checkpoint" errors still appear if transaction updates arrive during the first seconds after start, before header verification has caught up with the tip. Whether those updates are processed again later was not checked.
