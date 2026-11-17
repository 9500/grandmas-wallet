import type { ConfirmationDisagreement } from '@grandmas-wallet/chipnet/pool';

/**
 * What a device may say about the state of the chain (proposal section 17).
 *
 * A transaction's identifier proves its content. It does not prove that the transaction is in a block. A
 * device takes confirmations from the servers it is set up with, the user's own node among them. Until a
 * device checks block headers itself, it does not call chain state verified.
 */

export interface ChainConfidence {
  /** Never `true` while confirmations rest on servers. */
  verified: false;
  /** Where the engine's header check stands. */
  headerCheck: 'at the tip' | 'behind' | 'failed';
  /** Whether what the servers say can be acted on as settled: the header check has not failed and no two servers disagree. */
  final: boolean;
  /** What the device says, in words. */
  statement: string;
  disagreements: ConfirmationDisagreement[];
}

export interface ChainObservation {
  /** The engine's header check: the height it has checked, and the tip the servers report. `undefined` when it could not be read. */
  headers?: { verifiedHeight: number; currentHeight: number };
  /** Disagreements between servers about confirmations, as the pool of servers reports them. */
  disagreements?: ConfirmationDisagreement[];
}

export const chainConfidence = (observation: ChainObservation): ChainConfidence => {
  const disagreements = observation.disagreements ?? [];
  const headerCheck = observation.headers === undefined ? 'failed' : observation.headers.verifiedHeight >= observation.headers.currentHeight ? 'at the tip' : 'behind';
  const parts = ['Confirmations are taken from the servers this device is set up with; the device has not verified them itself.'];
  if (headerCheck === 'failed') parts.push('The check of block headers failed, so what is shown as confirmed rests on the servers alone and is not treated as final.');
  if (headerCheck === 'behind') parts.push(`The check of block headers stands at ${observation.headers?.verifiedHeight} of ${observation.headers?.currentHeight}.`);
  if (disagreements.length > 0) {
    parts.push(`The servers disagree about ${disagreements.length === 1 ? 'a confirmation' : `${disagreements.length} confirmations`}; nothing they disagree about is treated as final.`);
  }
  return { verified: false, headerCheck, final: headerCheck !== 'failed' && disagreements.length === 0, statement: parts.join(' '), disagreements };
};
