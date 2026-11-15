// Local fix for block header verification on chipnet after the switch to one-minute blocks
// (see docs/xo-chipnet-header-verification.md).
//
// Two installed packages are changed:
//   @electrum-cash/checkpoint   chipnet's difficulty parameters gain the point where the block time changes
//   @electrum-cash/application  the ASERT target is computed from accumulated ideal block time ("ticks"),
//                               as Bitcoin Cash Node does on its faster-blocks branch
//
// usage: node patches/chipnet-faster-blocks.mjs [--revert]
import { readFileSync, writeFileSync } from 'node:fs';

const revert = process.argv.includes('--revert');
const edits = [
  {
    file: '../node_modules/@electrum-cash/checkpoint/dist/index.mjs',
    // The chipnet block is the only one with this anchor timestamp followed by a one-hour half-life... and so is
    // testnet4, which shares the anchor; the checkpoint hash just above makes the match unique to chipnet.
    original: `		blockHash: "0000000038161e1d24f9cad45fc46bc4e5512453b8523bb5f393b46ea7f752cd",
		chainWork: void 0
	},
	difficultyParameters: {
		minimumDifficultyTarget: 26959535291011309493156476344723991336010898738574164086137773096960n,
		allowMinimumDifficultyBlocks: true,
		difficultyAlgorithm: "aserti3-2d",
		asertActivationHeight: 16845,
		asertAnchoredBlockHeight: 16844,
		asertAnchoredTarget: 26959535291011309493156476344723991336010898738574164086137773096960n,
		asertAnchoredParentTimestamp: 1605451779,
		asertHalfLifeInSeconds: 3600,
		asertIdealBlockTimeInSeconds: 600
	}`,
    patched: `		blockHash: "0000000038161e1d24f9cad45fc46bc4e5512453b8523bb5f393b46ea7f752cd",
		chainWork: void 0
	},
	difficultyParameters: {
		minimumDifficultyTarget: 26959535291011309493156476344723991336010898738574164086137773096960n,
		allowMinimumDifficultyBlocks: true,
		difficultyAlgorithm: "aserti3-2d",
		asertActivationHeight: 16845,
		asertAnchoredBlockHeight: 16844,
		asertAnchoredTarget: 26959535291011309493156476344723991336010898738574164086137773096960n,
		asertAnchoredParentTimestamp: 1605451779,
		asertHalfLifeInSeconds: 3600,
		asertIdealBlockTimeInSeconds: 600,
		/* grandmas-wallet patch: one-minute blocks (CHIP-2025-03) from the first block whose parent's median time past reached 1794744000 */
		idealBlockTimeChange: {
			firstBlockHeight: 332451,
			idealBlockTimeInSeconds: 60
		}
	}`,
  },
  {
    file: '../node_modules/@electrum-cash/application/dist/index.mjs',
    original: `	if (allowMinimumDifficultyBlocks) {
		if (blockTimestamp - parentTimestamp > 2 * asertIdealBlockTimeInSeconds) return minimumDifficultyTarget;
	}
	const heightDifference = blockHeight - 1 - asertAnchoredBlockHeight;
	const timeDifferenceInSeconds = parentTimestamp - asertAnchoredParentTimestamp;
	const expectedTimeInSeconds = asertIdealBlockTimeInSeconds * (heightDifference + 1);
	const exponent = BigInt(timeDifferenceInSeconds - expectedTimeInSeconds) * ASERT_FIXED_POINT_RADIX / BigInt(asertHalfLifeInSeconds);`,
    patched: `	/* grandmas-wallet patch: the ideal block time can change at a height; time on schedule is then counted in "ticks" */
	const { idealBlockTimeChange } = difficultyParameters;
	const idealBlockTimeAt = (height) => idealBlockTimeChange !== void 0 && height >= idealBlockTimeChange.firstBlockHeight ? idealBlockTimeChange.idealBlockTimeInSeconds : asertIdealBlockTimeInSeconds;
	const ticksAt = (height) => idealBlockTimeChange === void 0 || height < idealBlockTimeChange.firstBlockHeight ? height * asertIdealBlockTimeInSeconds : (idealBlockTimeChange.firstBlockHeight - 1) * asertIdealBlockTimeInSeconds + (height - idealBlockTimeChange.firstBlockHeight + 1) * idealBlockTimeChange.idealBlockTimeInSeconds;
	if (allowMinimumDifficultyBlocks) {
		if (blockTimestamp - parentTimestamp > 2 * idealBlockTimeAt(blockHeight)) return minimumDifficultyTarget;
	}
	const timeDifferenceInSeconds = parentTimestamp - asertAnchoredParentTimestamp;
	const expectedTimeInSeconds = ticksAt(blockHeight - 1) - ticksAt(asertAnchoredBlockHeight) + asertIdealBlockTimeInSeconds;
	const exponent = BigInt(timeDifferenceInSeconds - expectedTimeInSeconds) * ASERT_FIXED_POINT_RADIX / BigInt(asertHalfLifeInSeconds);`,
  },
  {
    file: '../node_modules/@electrum-cash/application/dist/index.mjs',
    original: `	if (shifts < 0n) nextTarget >>= -shifts;
	else nextTarget <<= shifts;
	if (nextTarget <= minimumDifficultyTarget) return nextTarget;`,
    patched: `	if (shifts < 0n) nextTarget >>= -shifts;
	else nextTarget <<= shifts;
	/* grandmas-wallet patch: a shorter ideal block time than the anchor's raises the target by the same ratio */
	nextTarget *= BigInt(asertIdealBlockTimeInSeconds / idealBlockTimeAt(blockHeight));
	if (nextTarget <= minimumDifficultyTarget) return nextTarget;`,
  },
];

for (const { file, original, patched } of edits) {
  const url = new URL(file, import.meta.url);
  const source = readFileSync(url, 'utf8');
  const [from, to] = revert ? [patched, original] : [original, patched];
  const name = file.split('node_modules/')[1];
  if (source.includes(to)) {
    console.log(`${name}: already ${revert ? 'unpatched' : 'patched'}`);
  } else if (source.split(from).length === 2) {
    writeFileSync(url, source.replace(from, to));
    console.log(`${name}: ${revert ? 'patch reverted' : 'patch applied'}`);
  } else {
    throw new Error(`${name} does not contain the expected code (application 0.5.2-development.16863504490, checkpoint 0.7.2).`);
  }
}
