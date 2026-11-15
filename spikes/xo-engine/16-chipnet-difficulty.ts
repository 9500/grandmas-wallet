// Experiment 16: check the chipnet difficulty rule, as read from the faster-blocks branch of Bitcoin Cash Node
// (merge request !2184, src/pow.cpp and src/chainparams.cpp), against real chipnet headers.
// run from the repository root: npx tsx spikes/xo-engine/16-chipnet-difficulty.ts
import { hexToBin } from '@bitauth/libauth';
import { ElectrumClient, type ElectrumClientEvents } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';

// Chipnet parameters from CChipNetParams in the faster-blocks branch.
const ACTIVATION_TIME = 1794744000; // upgrade2027ActivationTime: 2026-11-15 12:00:00 UTC, compared with the parent's median time past
const ANCHOR = { height: 16844, bits: 0x1d00ffff, previousTime: 1605451779, interval: 600 };
const HALF_LIFE = 3600; // nASERTHalfLife on test networks
const POW_LIMIT = (1n << 224n) - 1n; // 00000000ffff…ff
const LEGACY_INTERVAL = 600;
const UPGRADED_INTERVAL = 60;

const client = new ElectrumClient<ElectrumClientEvents>('spike', '1.4.1', new ElectrumWebSocket('chipnet.9500.cash', { port: 443, encrypted: true }));
await client.connect();
const cache = new Map<number, { time: number; bits: number }>();
const header = async (height: number) => {
  if (!cache.has(height)) {
    const bytes = hexToBin((await client.request('blockchain.block.header', height)) as string);
    const view = new DataView(bytes.buffer);
    cache.set(height, { time: view.getUint32(68, true), bits: view.getUint32(72, true) });
  }
  return cache.get(height)!;
};
const medianTimePast = async (height: number) => {
  const times: number[] = [];
  for (let h = height; h > height - 11; h--) times.push((await header(h)).time);
  return times.sort((a, b) => a - b)[5]!;
};

const fromCompact = (bits: number): bigint => {
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 0x7fffff);
  return exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
};
const toCompact = (target: bigint): number => {
  let size = Math.ceil(target.toString(16).length / 2);
  let mantissa = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number(target >> BigInt(8 * (size - 3)));
  if (mantissa & 0x800000) { mantissa >>= 8; size += 1; }
  return (size << 24) | mantissa;
};

/** CalculateASERT_TickBased from the branch's src/pow.cpp. */
const asertTarget = (timeDiff: number, tickDiff: number, nextInterval: number): bigint => {
  const exponent = (BigInt(timeDiff - (tickDiff + ANCHOR.interval)) * 65536n) / BigInt(HALF_LIFE); // truncates toward zero, as C++ does
  const shifts = exponent >> 16n; // floors
  const frac = exponent & 0xffffn;
  const factor = 65536n + ((195766423245049n * frac + 971821376n * frac * frac + 5127n * frac * frac * frac + (1n << 47n)) >> 48n);
  let target = fromCompact(ANCHOR.bits) * factor;
  const net = shifts - 16n;
  target = net <= 0n ? target >> -net : target << net;
  target *= BigInt(ANCHOR.interval / nextInterval);
  if (target === 0n) return 1n;
  return target > POW_LIMIT ? POW_LIMIT : target;
};

// The first block mined under the new rules is the first whose parent's median time past reached the activation time.
let first = 332440;
while ((await medianTimePast(first - 1)) < ACTIVATION_TIME) first++;
console.log('first block under the new rules:', first, '(parent median time past', await medianTimePast(first - 1), ')');

const intervalOf = (height: number) => (height >= first ? UPGRADED_INTERVAL : LEGACY_INTERVAL);
/** Ticks accumulated up to and including a block: the sum of the intervals of blocks 1..height. */
const ticksAt = (height: number) => (height < first ? height * LEGACY_INTERVAL : (first - 1) * LEGACY_INTERVAL + (height - first + 1) * UPGRADED_INTERVAL);

const expectedBits = async (height: number) => {
  const block = await header(height);
  const parent = await header(height - 1);
  if (block.time > parent.time + 2 * intervalOf(height)) return 0x1d00ffff; // test networks: minimum difficulty after a long gap
  return toCompact(asertTarget(parent.time - ANCHOR.previousTime, ticksAt(height - 1) - ANCHOR.height * LEGACY_INTERVAL, intervalOf(height)));
};

const tip = ((await client.request('blockchain.headers.get_tip')) as { height: number }).height;
const sample = [...Array.from({ length: 24 }, (_, i) => first - 8 + i), ...Array.from({ length: 300 }, (_, i) => tip - 299 + i)];
let mismatches = 0;
for (const height of sample) {
  const actual = (await header(height)).bits;
  const expected = await expectedBits(height);
  if (actual !== expected) mismatches++;
  if (height < first + 16 || actual !== expected) {
    console.log(height, `actual ${actual.toString(16)}`, `expected ${expected.toString(16)}`, actual === expected ? 'ok' : 'MISMATCH');
  }
}
console.log(`checked ${sample.length} headers (around activation and the last 300 up to ${tip}); mismatches: ${mismatches}`);
await client.disconnect(true);
process.exit(0);
