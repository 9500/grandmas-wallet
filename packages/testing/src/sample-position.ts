import { binToHex, hexToBin } from '@bitauth/libauth';
import type { PositionDescription, PositionKind } from '@grandmas-wallet/archive';
import { savingsJarScript } from '@grandmas-wallet/savings-jar';

/**
 * A kind of position for tests that run without an XO engine: a savings jar whose script is built
 * directly from its unlock time. A wallet has no such kind; it rebuilds positions from their templates.
 */

export const SAVINGS_JAR_KIND = 'savings-jar';

export const savingsJarKind: PositionKind = {
  kind: SAVINGS_JAR_KIND,
  interfaceVersions: [2],
  provides: [],
  lockingBytecode: (identity, parameters) => {
    const unlockTime = parameters['unlockTime'];
    if (typeof unlockTime !== 'number') throw new Error('A savings jar needs its unlock time.');
    return binToHex(savingsJarScript(identity, unlockTime).lockingBytecode);
  },
};

/** Describe a savings jar for the archive. */
export const describeSavingsJar = (
  identity: string,
  unlockTime: number,
  options: { positionId: string; template?: NonNullable<PositionDescription['template']>; label?: string },
): PositionDescription => ({
  positionId: options.positionId,
  kind: SAVINGS_JAR_KIND,
  interfaceVersion: 2,
  parameters: { unlockTime },
  lockingBytecode: binToHex(savingsJarScript(hexToBin(identity), unlockTime).lockingBytecode),
  requires: [],
  ...(options.template === undefined ? {} : { template: options.template }),
  ...(options.label === undefined ? {} : { label: options.label }),
});
