import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type ControllerState,
  afterFinalizeRecovery,
  afterOwnerAuthorize,
  afterOwnerUpdate,
  afterRequestRecovery,
  controllerLockingBytecode,
  decodeControllerState,
  encodeControllerState,
} from '../src/index.js';
import {
  CONTROLLER_VALUE,
  type Spend,
  activeState,
  anyoneCanSpend,
  build,
  controllerOutput,
  delayBytes,
  expectAccepted,
  expectChangeRejected,
  expectRejected,
  identity,
  key,
  newOwner,
  owner,
  pendingState,
  recoverer,
  stranger,
  verify,
} from './harness.js';

const authorize: Spend = { state: activeState, action: { kind: 'ownerAuthorize' }, signer: owner };
const cancel: Spend = { state: pendingState, action: { kind: 'ownerAuthorize' }, signer: owner };
const claim: Spend = {
  state: activeState,
  action: { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash },
  signer: recoverer,
};
const finalize: Spend = { state: pendingState, action: { kind: 'finalizeRecovery' }, signer: recoverer };
const rotate: Spend = {
  state: activeState,
  action: { kind: 'ownerUpdate', update: { ownerKeyHash: newOwner.keyHash } },
  signer: owner,
};

const allTransitions: [string, Spend][] = [
  ['owner authorize', authorize],
  ['cancel', cancel],
  ['request recovery', claim],
  ['finalize recovery', finalize],
  ['owner update', rotate],
];

describe('permitted transitions', () => {
  it('owner authorizes a transaction without the recoverer (C01)', () => {
    expectAccepted(authorize);
  });

  it('recoverer opens a claim', () => {
    expectAccepted(claim);
  });

  it('owner cancels a pending claim (C05, C10)', () => {
    expectAccepted(cancel);
    expect(afterOwnerAuthorize(pendingState)).toEqual(activeState);
  });

  it('recoverer finalizes after the delay and installs the proposed owner (C11)', () => {
    expectAccepted(finalize);
    const next = afterFinalizeRecovery(pendingState);
    expect(next.ownerKeyHash).toEqual(newOwner.keyHash);
    expect(next.ownerEpoch).toBe(1);
    expect(next.status).toBe('active');
  });

  it('accepts a longer wait than the delay requires', () => {
    expectAccepted({ ...finalize, sequence: 10 });
  });

  it('accepts a time-based delay', () => {
    const state: ControllerState = { ...pendingState, challengeDelay: { unit: 'time512', value: 5063 } };
    expectAccepted({ ...finalize, state });
  });

  it('owner rotates the owner key and starts a new epoch', () => {
    expectAccepted(rotate);
    expect(afterOwnerUpdate(activeState, { ownerKeyHash: newOwner.keyHash }).ownerEpoch).toBe(1);
  });

  it('owner replaces the recoverer and delay without a new epoch', () => {
    const update = { recovererKeyHash: stranger.keyHash, challengeDelay: { unit: 'time512', value: 100 } as const };
    expectAccepted({ ...rotate, action: { kind: 'ownerUpdate', update } });
    expect(afterOwnerUpdate(activeState, update).ownerEpoch).toBe(0);
  });

  it('owner update cancels a pending claim', () => {
    const update = { recovererKeyHash: stranger.keyHash };
    expectAccepted({ ...rotate, state: pendingState, action: { kind: 'ownerUpdate', update } });
    expect(afterOwnerUpdate(pendingState, update).status).toBe('active');
  });

  it('allows the controller value to grow', () => {
    for (const [, spend] of allTransitions) {
      const { nextCommitment } = { nextCommitment: build(spend).transaction.outputs[0]?.token?.nft?.commitment };
      if (nextCommitment === undefined) throw new Error('missing successor');
      expectAccepted({ ...spend, controllerSuccessor: controllerOutput(nextCommitment, CONTROLLER_VALUE + 500n) });
    }
  });

  it('runs a full lifecycle: spend, claim, cancel, claim, finalize, spend with the new key', () => {
    let state = activeState;
    const step = (spend: Omit<Spend, 'state'>): void => {
      const resolved = build({ ...spend, state });
      expectAccepted(resolved);
      const commitment = resolved.transaction.outputs[0]?.token?.nft?.commitment;
      if (commitment === undefined) throw new Error('missing successor');
      state = decodeControllerState(commitment);
    };
    step({ action: { kind: 'ownerAuthorize' }, signer: owner });
    step({ action: claim.action, signer: recoverer });
    step({ action: { kind: 'ownerAuthorize' }, signer: owner });
    step({ action: claim.action, signer: recoverer });
    step({ action: { kind: 'finalizeRecovery' }, signer: recoverer });
    step({ action: { kind: 'ownerAuthorize' }, signer: newOwner });
    expect(state).toEqual({ ...activeState, ownerEpoch: 1, ownerKeyHash: newOwner.keyHash });
  });
});

describe('authority', () => {
  it('rejects every transition signed by an unrelated key', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, { signer: stranger });
    }
  });

  it('rejects a valid signature presented with the authorized public key of someone else', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, { signer: stranger, presentedPublicKey: spend.signer.publicKey });
    }
  });

  it('rejects the recoverer using owner transitions', () => {
    expectChangeRejected(authorize, { signer: recoverer });
    expectChangeRejected(cancel, { signer: recoverer });
    expectChangeRejected(rotate, { signer: recoverer });
  });

  it('rejects the owner or the proposed owner using recoverer transitions', () => {
    expectChangeRejected(claim, { signer: owner });
    expectChangeRejected(finalize, { signer: owner });
    expectChangeRejected(finalize, { signer: newOwner });
  });

  it('rejects the proposed owner acting as owner while the claim is pending', () => {
    expectChangeRejected(cancel, { signer: newOwner });
  });

  it('rejects the old owner after a completed recovery (C12)', () => {
    const recovered = afterFinalizeRecovery(pendingState);
    expectChangeRejected({ ...authorize, state: recovered, signer: newOwner }, { signer: owner });
    expectChangeRejected(
      { ...rotate, state: recovered, signer: newOwner, action: { kind: 'ownerUpdate', update: { ownerKeyHash: owner.keyHash } } },
      { signer: owner },
    );
  });

  it('rejects signatures that do not cover the whole transaction', () => {
    // 0x41 ALL, 0x42 NONE, 0x43 SINGLE, 0xc1 ALL|ANYONECANPAY, 0x62 NONE|UTXOS
    for (const signingType of [0x41, 0x42, 0x43, 0xc1, 0x62]) {
      for (const [, spend] of allTransitions) {
        expectChangeRejected(spend, { signingType });
      }
    }
  });
});

describe('challenge delay (C03, C04)', () => {
  it('rejects finalization before the delay has passed', () => {
    expectChangeRejected(finalize, { sequence: 2 });
    expectChangeRejected(finalize, { sequence: 0 });
  });

  it('rejects finalization of a controller that has no pending claim', () => {
    expectRejected({
      ...finalize,
      state: activeState,
      nextCommitment: encodeControllerState({ ...activeState, ownerEpoch: 1, ownerKeyHash: newOwner.keyHash }),
    });
  });

  it('rejects a sequence number with relative locktime disabled', () => {
    expectChangeRejected(finalize, { sequence: 0x80000003 });
    expectChangeRejected(finalize, { sequence: 0xffffffff });
  });

  it('rejects a time-based sequence for a block-based delay, and the reverse', () => {
    expectChangeRejected(finalize, { sequence: 0x400000 | 0xffff });
    const timed: Spend = { ...finalize, state: { ...pendingState, challengeDelay: { unit: 'time512', value: 10 } } };
    expectChangeRejected(timed, { sequence: 0xffff });
  });

  it('rejects a transaction version that does not enforce relative locktime', () => {
    expectChangeRejected(finalize, { version: 1 });
  });

  it('rejects any other transaction version for every transition', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, { version: 1 });
      expectChangeRejected(spend, { version: 3 });
    }
  });
});

describe('pending claim is fixed (C06)', () => {
  it('rejects a second claim while one is pending', () => {
    expectRejected({
      ...claim,
      state: pendingState,
      action: { kind: 'requestRecovery', proposedOwnerKeyHash: stranger.keyHash },
      nextCommitment: encodeControllerState({ ...pendingState, proposedOwnerKeyHash: stranger.keyHash }),
    });
  });

  it('rejects re-issuing the same claim, which would restart nothing but churn the controller', () => {
    expectRejected({ ...claim, state: pendingState, nextCommitment: encodeControllerState(pendingState) });
  });

  it('rejects finalization that installs a different owner than the claim named', () => {
    const next = afterFinalizeRecovery(pendingState);
    expectChangeRejected(finalize, {
      nextCommitment: encodeControllerState({ ...next, ownerKeyHash: stranger.keyHash }),
    });
    expectChangeRejected(finalize, {
      nextCommitment: encodeControllerState({ ...next, ownerKeyHash: recoverer.keyHash }),
    });
  });

  it('rejects finalization that also changes the recoverer, delay, or epoch step', () => {
    const next = afterFinalizeRecovery(pendingState);
    for (const changed of [
      { ...next, recovererKeyHash: stranger.keyHash },
      { ...next, challengeDelay: { unit: 'blocks', value: 1 } as const },
      { ...next, ownerEpoch: 0 },
      { ...next, ownerEpoch: 2 },
      { ...next, status: 'pending' as const, proposedOwnerKeyHash: stranger.keyHash },
    ]) {
      expectChangeRejected(finalize, { nextCommitment: encodeControllerState(changed) });
    }
  });

  it('rejects a claim that changes anything but status and proposed owner', () => {
    const next = afterRequestRecovery(activeState, newOwner.keyHash);
    for (const changed of [
      { ...next, ownerKeyHash: stranger.keyHash },
      { ...next, recovererKeyHash: stranger.keyHash },
      { ...next, challengeDelay: { unit: 'blocks', value: 1 } as const },
      { ...next, ownerEpoch: 1 },
    ]) {
      expectChangeRejected(claim, { nextCommitment: encodeControllerState(changed) });
    }
  });

  it('rejects a claim whose recorded proposed owner differs from the one presented', () => {
    expectChangeRejected(claim, {
      nextCommitment: encodeControllerState({ ...pendingState, proposedOwnerKeyHash: stranger.keyHash }),
    });
  });

  it('rejects a claim with no proposed owner or one of the wrong size', () => {
    const zero = new Uint8Array(20);
    const next = encodeControllerState(pendingState);
    next.fill(0, 49, 69);
    expectRejected({ ...claim, action: { kind: 'requestRecovery', proposedOwnerKeyHash: zero }, nextCommitment: next });
    expectRejected({
      ...claim,
      action: { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash.subarray(0, 19) },
      nextCommitment: encodeControllerState(pendingState).subarray(0, 68),
    });
  });

  it('rejects a claim that leaves the controller active', () => {
    expectChangeRejected(claim, { nextCommitment: encodeControllerState(activeState) });
  });
});

describe('owner transitions keep their limits', () => {
  it('rejects an owner authorization that changes any state field', () => {
    for (const changed of [
      { ...activeState, ownerKeyHash: stranger.keyHash },
      { ...activeState, recovererKeyHash: stranger.keyHash },
      { ...activeState, challengeDelay: { unit: 'blocks', value: 9 } as const },
      { ...activeState, ownerEpoch: 1 },
    ]) {
      expectChangeRejected(authorize, { nextCommitment: encodeControllerState(changed) });
    }
  });

  it('rejects a cancellation that leaves the claim pending', () => {
    expectChangeRejected(cancel, { nextCommitment: encodeControllerState(pendingState) });
  });

  it('rejects an owner change that keeps the old epoch, and a non-change that advances it', () => {
    const rotated = afterOwnerUpdate(activeState, { ownerKeyHash: newOwner.keyHash });
    expectChangeRejected(rotate, { nextCommitment: encodeControllerState({ ...rotated, ownerEpoch: 0 }) });
    const sameOwner: Spend = { ...rotate, action: { kind: 'ownerUpdate', update: { recovererKeyHash: stranger.keyHash } } };
    expectChangeRejected(sameOwner, {
      nextCommitment: encodeControllerState({ ...activeState, recovererKeyHash: stranger.keyHash, ownerEpoch: 1 }),
    });
  });

  it('rejects an update to a zero owner or recoverer', () => {
    const zero = new Uint8Array(20);
    for (const update of [{ ownerKeyHash: zero }, { recovererKeyHash: zero }]) {
      const next = encodeControllerState(afterOwnerUpdate(activeState, { ownerKeyHash: newOwner.keyHash }));
      if (update.ownerKeyHash !== undefined) next.fill(0, 6, 26);
      else next.fill(0, 26, 46);
      expectRejected({ ...rotate, action: { kind: 'ownerUpdate', update: { ownerKeyHash: newOwner.keyHash, ...update } }, nextCommitment: next });
    }
  });

  it('rejects an update to an unusable delay', () => {
    // zero value, zero value with time flag, disable-style high bit, stray bit 16
    for (const raw of ['000000', '000040', '030080', '030001']) {
      const rawDelay = hexToBin(raw);
      const next = encodeControllerState(activeState);
      next.set(rawDelay, 46);
      expectRejected({
        ...rotate,
        action: { kind: 'ownerUpdate', update: {}, rawDelay },
        nextCommitment: next,
      });
    }
    // The same construction with a usable delay is accepted.
    const rawDelay = delayBytes(0x400000 | 7);
    const next = encodeControllerState(activeState);
    next.set(rawDelay, 46);
    expectAccepted({ ...rotate, action: { kind: 'ownerUpdate', update: {}, rawDelay }, nextCommitment: next });
  });
});

describe('identity and continuity (C09)', () => {
  const successorOf = (spend: Spend) => {
    const successor = build(spend).transaction.outputs[0];
    if (successor?.token?.nft === undefined) throw new Error('missing successor');
    return { ...successor, token: successor.token, nft: successor.token.nft };
  };

  it('rejects a successor paid to a different script', () => {
    for (const [, spend] of allTransitions) {
      const { token, valueSatoshis } = successorOf(spend);
      expectChangeRejected(spend, { controllerSuccessor: { lockingBytecode: anyoneCanSpend, valueSatoshis, token } });
    }
  });

  it('rejects a successor without the identity token', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, {
        controllerSuccessor: { lockingBytecode: controllerLockingBytecode, valueSatoshis: CONTROLLER_VALUE },
      });
    }
  });

  it('rejects dropping the controller output', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, { controllerSuccessor: null });
    }
  });

  it('rejects downgrading the identity token to immutable', () => {
    for (const [, spend] of allTransitions) {
      const { lockingBytecode, valueSatoshis, token, nft } = successorOf(spend);
      expectChangeRejected(spend, {
        controllerSuccessor: { lockingBytecode, valueSatoshis, token: { ...token, nft: { ...nft, capability: 'none' } } },
      });
    }
  });

  it('rejects moving the identity token to a later output', () => {
    for (const [, spend] of allTransitions) {
      const successor = build(spend).transaction.outputs[0];
      if (successor === undefined) throw new Error('missing successor');
      expectChangeRejected(spend, {
        controllerSuccessor: { lockingBytecode: controllerLockingBytecode, valueSatoshis: CONTROLLER_VALUE },
        extraOutputs: [successor],
      });
    }
  });

  it('rejects a controller that is not the first input', () => {
    for (const [, spend] of allTransitions) {
      expectChangeRejected(spend, { controllerSecond: true });
    }
  });

  it('rejects a controller UTXO without a token, or with a fungible-only or immutable token', () => {
    const commitment = encodeControllerState(activeState);
    const base = { lockingBytecode: controllerLockingBytecode, valueSatoshis: CONTROLLER_VALUE };
    const sources = [
      base,
      { ...base, token: { amount: 10n, category: identity } },
      { ...base, token: { amount: 0n, category: identity, nft: { capability: 'none' as const, commitment } } },
    ];
    for (const controllerSource of sources) {
      expectChangeRejected(authorize, { controllerSource, controllerSuccessor: controllerSource });
    }
  });

  it('rejects an unknown state version (X02)', () => {
    for (const [, spend] of allTransitions) {
      const inputCommitment = encodeControllerState(spend.state);
      inputCommitment[0] = 0x02;
      const nextCommitment = successorOf(spend).nft.commitment.slice();
      nextCommitment[0] = 0x02;
      expectChangeRejected(spend, { inputCommitment, nextCommitment });
    }
  });

  it('rejects a state of the wrong length', () => {
    const inputCommitment = new Uint8Array([...encodeControllerState(activeState), 0x00]);
    expectChangeRejected(authorize, { inputCommitment });
  });

  it('rejects fungible tokens appearing on the controller', () => {
    const { lockingBytecode, valueSatoshis, token } = successorOf(authorize);
    const withFungible = {
      lockingBytecode,
      valueSatoshis,
      token: { ...token, amount: 5n },
    };
    // A source that already holds fungible tokens must keep exactly that amount.
    expectAccepted({ ...authorize, controllerSource: withFungible, controllerSuccessor: withFungible });
    expectRejected({
      ...authorize,
      controllerSource: withFungible,
      controllerSuccessor: { ...withFungible, token: { ...token, amount: 4n } },
    });
  });
});

describe('controller value (C14)', () => {
  it('rejects any transition that lowers the controller value', () => {
    for (const [, spend] of allTransitions) {
      const successor = build(spend).transaction.outputs[0];
      if (successor === undefined) throw new Error('missing successor');
      expectChangeRejected(spend, { controllerSuccessor: { ...successor, valueSatoshis: CONTROLLER_VALUE - 1n } });
    }
  });
});

describe('harness sanity', () => {
  it('reports a reason for rejected transactions', () => {
    expect(verify({ ...authorize, signer: key(0x55) })).toBeTypeOf('string');
  });
});
