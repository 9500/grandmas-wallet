import type { Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type ControllerState,
  afterFinalizeRecovery,
  assetScript,
  controllerScript,
  encodeControllerState,
  savingsJarScript,
} from '../src/index.js';
import {
  type ProtectedInput,
  type Spend,
  activeState,
  anyoneCanSpend,
  controllerOutput,
  expectAccepted,
  expectRejected,
  expectRejectedByProtectedInput,
  failingInput,
  identity,
  newOwner,
  owner,
  pendingState,
  recoverer,
  stranger,
} from './harness.js';

const asset = assetScript(identity);
const UNLOCK_HEIGHT = 1_000;
const jar = savingsJarScript(identity, UNLOCK_HEIGHT);

const tokenCategory = new Uint8Array(32).fill(0x70);
const recipient = anyoneCanSpend;

const bchAsset = (): ProtectedInput => ({
  source: { lockingBytecode: asset.lockingBytecode, valueSatoshis: 10_000n },
  script: asset,
});

const jarInput = (): ProtectedInput => ({
  source: { lockingBytecode: jar.lockingBytecode, valueSatoshis: 50_000n },
  script: jar,
});

const payment: Output = { lockingBytecode: recipient, valueSatoshis: 6_000n };
const change: Output = { lockingBytecode: asset.lockingBytecode, valueSatoshis: 3_500n };

const authorize: Spend = { state: activeState, action: { kind: 'ownerAuthorize' }, signer: owner };
const claim: Spend = {
  state: activeState,
  action: { kind: 'requestRecovery', proposedOwnerKeyHash: newOwner.keyHash },
  signer: recoverer,
};
const finalize: Spend = { state: pendingState, action: { kind: 'finalizeRecovery' }, signer: recoverer };

const send: Spend = { ...authorize, protectedInputs: [bchAsset()], extraOutputs: [payment, change] };
const withdraw: Spend = {
  ...authorize,
  protectedInputs: [jarInput()],
  extraOutputs: [{ lockingBytecode: asset.lockingBytecode, valueSatoshis: 49_000n }],
  locktime: UNLOCK_HEIGHT,
};

/** Both kinds of protected input, as [name, input factory, base transaction]. */
const protectedKinds: [string, () => ProtectedInput, Spend][] = [
  ['asset', bchAsset, send],
  ['savings jar', jarInput, withdraw],
];

describe('owner spends protected assets', () => {
  it('sends BCH with change back to the wallet, without the recoverer (C01)', () => {
    expectAccepted(send);
  });

  it('sends fungible tokens with token change back to the wallet (C02)', () => {
    const holding: ProtectedInput = {
      ...bchAsset(),
      source: { lockingBytecode: asset.lockingBytecode, valueSatoshis: 1_000n, token: { amount: 100n, category: tokenCategory } },
    };
    const outputs = (sent: bigint, kept: bigint): Output[] => [
      { lockingBytecode: recipient, valueSatoshis: 800n, token: { amount: sent, category: tokenCategory } },
      { lockingBytecode: asset.lockingBytecode, valueSatoshis: 800n, token: { amount: kept, category: tokenCategory } },
    ];
    expectAccepted({ ...authorize, protectedInputs: [holding], extraOutputs: outputs(60n, 40n) });
    // Token amounts cannot be inflated by the transaction.
    expectRejected({ ...authorize, protectedInputs: [holding], extraOutputs: outputs(60n, 41n) });
  });

  it('transfers an NFT with its commitment intact (C02)', () => {
    const nft = { capability: 'none' as const, commitment: Uint8Array.of(1, 2, 3) };
    const holding: ProtectedInput = {
      ...bchAsset(),
      source: { lockingBytecode: asset.lockingBytecode, valueSatoshis: 1_000n, token: { amount: 0n, category: tokenCategory, nft } },
    };
    const transferred = (commitment: Uint8Array): Output[] => [
      { lockingBytecode: recipient, valueSatoshis: 800n, token: { amount: 0n, category: tokenCategory, nft: { ...nft, commitment } } },
    ];
    expectAccepted({ ...authorize, protectedInputs: [holding], extraOutputs: transferred(nft.commitment) });
    expectRejected({ ...authorize, protectedInputs: [holding], extraOutputs: transferred(Uint8Array.of(9)) });
  });

  it('spends several protected inputs under one approval', () => {
    expectAccepted({
      ...authorize,
      protectedInputs: [bchAsset(), bchAsset(), jarInput()],
      extraOutputs: [payment],
      locktime: UNLOCK_HEIGHT,
    });
  });

  it('spends while a recovery claim is pending, cancelling the claim (C10)', () => {
    expectAccepted({ ...send, state: pendingState });
    expectAccepted({ ...withdraw, state: pendingState });
  });

  it('allows a spend alongside an owner update that changes nothing', () => {
    expectAccepted({ ...send, action: { kind: 'ownerUpdate', update: {} } });
  });
});

describe('approval comes from the controller', () => {
  it.each(protectedKinds)('%s: is unlocked by its script alone, with no key or signature', (_name, input) => {
    const { script } = input();
    expect(script.unlockingBytecode.length).toBeLessThan(script.redeemBytecode.length + 4);
    expect([...script.unlockingBytecode.slice(-script.redeemBytecode.length)]).toEqual([...script.redeemBytecode]);
  });

  it.each(protectedKinds)('%s: cannot be spent when anyone but the owner signs for the controller', (_name, _input, base) => {
    expectAccepted(base);
    for (const signer of [recoverer, newOwner, stranger]) {
      expect(failingInput({ ...base, signer })).toBe(0);
    }
  });

  it.each(protectedKinds)('%s: cannot be spent when the owner\'s signature leaves inputs or outputs open', (_name, _input, base) => {
    // 0xc1 would let further inputs be added after signing; 0x42 and 0x43 leave outputs open.
    for (const signingType of [0xc1, 0x42, 0x43, 0xc3]) {
      expect(failingInput({ ...base, signingType })).toBe(0);
    }
  });

  it.each(protectedKinds)('%s: is spent under either accepted signing type', (_name, _input, base) => {
    expectAccepted({ ...base, signingType: 0x41 });
    expectAccepted({ ...base, signingType: 0x61 });
  });
});

describe('recoverer cannot spend through a recovery claim (C07)', () => {
  it.each(protectedKinds)('%s: rejects a spend attached to a claim', (_name, _input, base) => {
    // The claim itself is valid; the protected input refuses to ride along.
    expectAccepted({ ...claim });
    expectRejectedByProtectedInput({ ...base, ...claim });
  });
});

describe('recovery completion cannot carry a spend (C08)', () => {
  it.each(protectedKinds)('%s: rejects a spend attached to a completed recovery', (_name, _input, base) => {
    expectAccepted({ ...finalize, ...(base.locktime === undefined ? {} : { locktime: base.locktime }) });
    expectRejectedByProtectedInput({ ...base, ...finalize });
  });

  it.each(protectedKinds)('%s: rejects a spend attached to an early completion attempt', (_name, _input, base) => {
    expect(failingInput({ ...base, ...finalize, sequence: 1 })).toBe(0);
  });
});

describe('owner changes and spending are separate steps', () => {
  it.each(protectedKinds)('%s: rejects a spend in the transaction that replaces the owner or recoverer', (_name, _input, base) => {
    for (const update of [{ ownerKeyHash: newOwner.keyHash }, { recovererKeyHash: stranger.keyHash }]) {
      const rotation: Spend = { ...base, action: { kind: 'ownerUpdate', update } };
      expectAccepted({ ...rotation, protectedInputs: [], extraOutputs: [] });
      expectRejectedByProtectedInput(rotation);
    }
  });
});

describe('after a completed recovery (C12)', () => {
  const recovered: ControllerState = afterFinalizeRecovery(pendingState);

  it.each(protectedKinds)('%s: the new owner spends the same output without it having moved', (_name, _input, base) => {
    expectAccepted({ ...base, state: recovered, signer: newOwner });
  });

  it.each(protectedKinds)('%s: the old owner key is rejected', (_name, _input, base) => {
    expect(failingInput({ ...base, state: recovered, signer: owner })).toBe(0);
  });
});

describe('only the genuine controller counts (C09)', () => {
  const otherIdentity = new Uint8Array(32).fill(0x66);
  const strangerState: ControllerState = { ...activeState, ownerKeyHash: stranger.keyHash };
  const impostor = (category: Uint8Array, capability: 'mutable' | 'minting' | 'none'): Output => ({
    ...controllerOutput(encodeControllerState(strangerState)),
    lockingBytecode: controllerScript(category).lockingBytecode,
    token: { amount: 0n, category, nft: { capability, commitment: encodeControllerState(strangerState) } },
  });

  it.each(protectedKinds)('%s: rejects a controller of another identity', (_name, input, base) => {
    // A complete, valid controller that names the attacker as owner, but for a different identity.
    const fake = impostor(otherIdentity, 'mutable');
    const attack: Spend = { ...base, state: strangerState, signer: stranger, controllerSource: fake, controllerSuccessor: fake };
    expectAccepted({ ...attack, protectedInputs: [], extraOutputs: [] });
    expectRejectedByProtectedInput({ ...attack, protectedInputs: [input()] });
  });

  it.each(protectedKinds)('%s: rejects a token of the right category with the wrong capability', (_name, input, base) => {
    for (const capability of ['none', 'minting'] as const) {
      const fake = impostor(identity, capability);
      expectRejected({
        ...base,
        state: strangerState,
        signer: stranger,
        controllerSource: fake,
        controllerSuccessor: fake,
        protectedInputs: [input()],
      });
    }
  });

  it.each(protectedKinds)('%s: rejects a transaction whose first input is not the controller', (_name, _input, base) => {
    expectRejected({ ...base, controllerSecond: true });
  });
});

describe('savings jar keeps its time lock', () => {
  it('rejects a withdrawal before the unlock time', () => {
    expectAccepted(withdraw);
    expectRejectedByProtectedInput({ ...withdraw, locktime: UNLOCK_HEIGHT - 1 });
    expectRejectedByProtectedInput({ ...withdraw, locktime: 0 });
  });

  it('accepts a withdrawal any time after the unlock time', () => {
    expectAccepted({ ...withdraw, locktime: UNLOCK_HEIGHT + 500 });
  });

  it('rejects a locktime of the other kind, and a jar input that disables locktime', () => {
    expectRejectedByProtectedInput({ ...withdraw, locktime: 1_800_000_000 });
    expectRejectedByProtectedInput({ ...withdraw, protectedInputs: [{ ...jarInput(), sequence: 0xffffffff }] });
  });

  it('supports a timestamp unlock time', () => {
    const timed = savingsJarScript(identity, 1_800_000_000);
    const input: ProtectedInput = { ...jarInput(), source: { lockingBytecode: timed.lockingBytecode, valueSatoshis: 50_000n }, script: timed };
    expectAccepted({ ...withdraw, protectedInputs: [input], locktime: 1_800_000_000 });
    expectRejectedByProtectedInput({ ...withdraw, protectedInputs: [input], locktime: 1_799_999_999 });
  });

  it('recovery does not shorten the lock: the new owner must also wait', () => {
    const recovered = afterFinalizeRecovery(pendingState);
    const byNewOwner: Spend = { ...withdraw, state: recovered, signer: newOwner };
    expectAccepted(byNewOwner);
    expectRejectedByProtectedInput({ ...byNewOwner, locktime: UNLOCK_HEIGHT - 1 });
  });

  it('a jar is specific to its identity and unlock time', () => {
    const other = savingsJarScript(identity, UNLOCK_HEIGHT + 1);
    expect(other.lockingBytecode).not.toEqual(jar.lockingBytecode);
    expect(savingsJarScript(new Uint8Array(32).fill(0x66), UNLOCK_HEIGHT).lockingBytecode).not.toEqual(jar.lockingBytecode);
    expect(assetScript(identity).lockingBytecode).not.toEqual(jar.lockingBytecode);
  });
});

describe('script construction', () => {
  it('rejects malformed parameters', () => {
    expect(() => assetScript(new Uint8Array(31))).toThrow();
    expect(() => savingsJarScript(identity, -1)).toThrow();
    expect(() => savingsJarScript(identity, 1.5)).toThrow();
  });
});
