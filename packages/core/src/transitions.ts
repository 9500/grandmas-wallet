import {
  type ChallengeDelay,
  type ControllerState,
  ControllerStateError,
  MAX_OWNER_EPOCH,
  validateControllerState,
} from './state.js';

/**
 * The controller state each transition must produce. These mirror the rules
 * enforced by the controller contract, so a client can compute the successor
 * commitment before building a transaction and can check a transition it
 * observes on chain.
 */

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

const withoutClaim = (state: ControllerState): ControllerState => {
  const { proposedOwnerKeyHash: _cleared, ...rest } = state;
  return { ...rest, status: 'active' };
};

const checked = (state: ControllerState): ControllerState => {
  validateControllerState(state);
  return state;
};

/** Owner approves a transaction; a pending claim, if any, is cancelled. */
export const afterOwnerAuthorize = (state: ControllerState): ControllerState => checked(withoutClaim(state));

/** Recoverer opens a claim. Only valid when no claim is pending. */
export const afterRequestRecovery = (state: ControllerState, proposedOwnerKeyHash: Uint8Array): ControllerState => {
  if (state.status !== 'active') {
    throw new ControllerStateError('inconsistent-claim', 'A recovery claim is already pending.');
  }
  return checked({ ...state, status: 'pending', proposedOwnerKeyHash });
};

/** Recoverer completes the pending claim after the challenge delay. */
export const afterFinalizeRecovery = (state: ControllerState): ControllerState => {
  if (state.status !== 'pending' || state.proposedOwnerKeyHash === undefined) {
    throw new ControllerStateError('inconsistent-claim', 'There is no pending recovery claim to finalize.');
  }
  if (state.ownerEpoch >= MAX_OWNER_EPOCH) {
    throw new ControllerStateError('invalid-owner-epoch', 'Owner epoch cannot be incremented further.');
  }
  return checked({
    ...withoutClaim(state),
    ownerEpoch: state.ownerEpoch + 1,
    ownerKeyHash: state.proposedOwnerKeyHash,
  });
};

export interface ControllerUpdate {
  ownerKeyHash?: Uint8Array;
  recovererKeyHash?: Uint8Array;
  challengeDelay?: ChallengeDelay;
}

/** Owner replaces the owner key, recoverer, or delay; a pending claim, if any, is cancelled. */
export const afterOwnerUpdate = (state: ControllerState, update: ControllerUpdate): ControllerState => {
  const ownerKeyHash = update.ownerKeyHash ?? state.ownerKeyHash;
  const ownerChanged = !sameBytes(ownerKeyHash, state.ownerKeyHash);
  if (ownerChanged && state.ownerEpoch >= MAX_OWNER_EPOCH) {
    throw new ControllerStateError('invalid-owner-epoch', 'Owner epoch cannot be incremented further.');
  }
  return checked({
    ...withoutClaim(state),
    ownerEpoch: ownerChanged ? state.ownerEpoch + 1 : state.ownerEpoch,
    ownerKeyHash,
    recovererKeyHash: update.recovererKeyHash ?? state.recovererKeyHash,
    challengeDelay: update.challengeDelay ?? state.challengeDelay,
  });
};
