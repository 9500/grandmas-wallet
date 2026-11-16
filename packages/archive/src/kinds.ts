import { binToHex, hexToBin } from '@bitauth/libauth';
import { savingsJarScript } from '@grandmas-wallet/core';

import type { PositionDescription } from './records.js';

/**
 * The kinds of position a wallet knows how to rebuild.
 *
 * A record is a hint, not an authority: for a known kind the script is
 * rebuilt from the recorded parameters and the wallet identity, and must
 * equal the recorded script. A record that fails this cannot make the wallet
 * look anywhere it would not have looked by its own rules.
 */

export interface PositionKind {
  kind: string;
  /** Versions of the owner-approval interface this kind is known to work with. */
  interfaceVersions: number[];
  /** Requirements this wallet can meet for the kind. */
  provides: string[];
  /**
   * The script for these parameters under this wallet identity, as hex.
   * @throws if the parameters are not valid for the kind
   */
  lockingBytecode(identity: Uint8Array, parameters: PositionDescription['parameters']): string;
}

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
  options: { positionId: string; template?: PositionDescription['template']; label?: string },
): PositionDescription => ({
  positionId: options.positionId,
  kind: SAVINGS_JAR_KIND,
  interfaceVersion: 2,
  parameters: { unlockTime },
  lockingBytecode: savingsJarKind.lockingBytecode(hexToBin(identity), { unlockTime }),
  requires: [],
  ...(options.template === undefined ? {} : { template: options.template }),
  ...(options.label === undefined ? {} : { label: options.label }),
});
