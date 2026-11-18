import { medianTimePast } from '@grandmas-wallet/app';
import { Card, Info, formatDuration, useEvery } from '@grandmas-wallet/ui';
import { useState } from 'preact/hooks';

import type { Session } from './session.js';

/**
 * The chain's clock (proposal section 17): the time the network measures a waiting period by. It is the median
 * of the times of the last eleven blocks, so it moves only when a block comes and trails the time on the wall.
 * The page reads it again whenever the chain has a new block.
 */
export interface ChainClockReading {
  /** The height of the last block. */
  height: number;
  /** The chain's clock after that block, Unix seconds. */
  clock: number;
  /** The time written in that block, Unix seconds. */
  blockTime: number;
}

/** The chain's clock now, read again every few seconds; the clock itself is worked out when the height changes. */
export const useChainClock = (session: Session): ChainClockReading | undefined => {
  const [reading, setReading] = useState<ChainClockReading | undefined>();
  const [, setTick] = useState(0);
  useEvery(
    5_000,
    async () => {
      const tip = await session.chain.tip();
      if (tip.height !== reading?.height) setReading({ height: tip.height, clock: await medianTimePast(session.chain, tip.height), blockTime: tip.time });
      // How long ago the last block came is counted on, block or no block.
      else setTick((count) => count + 1);
    },
    [],
  );
  return reading;
};

/** A time of day with its seconds, and the date when it is not today's. */
export const clockTime = (unixSeconds: number): string => {
  const date = new Date(unixSeconds * 1000);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString(undefined, { dateStyle: 'medium' })}, ${time}`;
};

/** The chain's clock in one line: the clock, the last block and how long ago its time was. */
export const ChainClock = ({ reading }: { reading: ChainClockReading | undefined }) => {
  const ago = reading === undefined ? 0 : Math.floor(Date.now() / 1000) - reading.blockTime;
  return (
    <Card flat cls="chain-clock">
      <div class="row spread">
        <span class="chain-clock-main">
          <span class="small muted">Chain's clock</span>
          <strong class="mono" data-testid="chain-clock" data-value={reading === undefined ? '' : String(reading.clock)}>
            {reading === undefined ? '…' : clockTime(reading.clock)}
          </strong>
          <Info label="About the chain's clock">
            <span>The network measures a waiting period by this clock, not by the time on the wall.</span>
            <span>It is the middle one of the times of the last eleven blocks, so it moves only when a block comes, and it runs behind the real time: about an hour with a block every ten minutes, a few minutes on a test network with faster blocks.</span>
          </Info>
        </span>
        {reading !== undefined && (
          <span class="small muted" data-testid="chain-height" data-value={String(reading.height)}>
            block {reading.height.toLocaleString('en-US')}
            {ago >= 0 && ` · ${ago < 5 ? 'just now' : `${formatDuration(ago)} ago`}`}
          </span>
        )}
      </div>
    </Card>
  );
};
