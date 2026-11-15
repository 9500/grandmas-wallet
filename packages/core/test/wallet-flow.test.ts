import type { Output } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import {
  type BuiltTransaction,
  type ControllerAction,
  type ControllerSnapshot,
  type ControllerState,
  IdentityValidationError,
  type KeyPair,
  type Utxo,
  assetScript,
  buildTransaction,
  controllerInput,
  controllerOutput,
  controllerSuccessor,
  followController,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  protectedInput,
  savingsJarScript,
  validateGenesis,
  verifyTransaction,
} from '../src/index.js';

const keyOf = (seed: number): KeyPair => keyPairFromPrivateKey(new Uint8Array(32).fill(seed));
const funder = keyOf(0x10);
const owner = keyOf(0x11);
const recoverer = keyOf(0x12);
const replacement = keyOf(0x13);

const funderLocking = p2pkhLockingBytecode(funder.keyHash);
const fundingUtxo: Utxo = {
  transactionHash: Uint8Array.from({ length: 32 }, (_, i) => 0xe0 - i),
  index: 0,
  output: { lockingBytecode: funderLocking, valueSatoshis: 100_000n },
};
const identity = fundingUtxo.transactionHash;

const initialState: ControllerState = {
  version: 1,
  status: 'active',
  ownerEpoch: 0,
  ownerKeyHash: owner.keyHash,
  recovererKeyHash: recoverer.keyHash,
  challengeDelay: { unit: 'time512', value: 1 },
};

const asset = assetScript(identity);
const UNLOCK_TIME = 1_800_000_000;
const jar = savingsJarScript(identity, UNLOCK_TIME);

const accepted = (built: BuiltTransaction): BuiltTransaction => {
  expect(verifyTransaction(built)).toBe(true);
  return built;
};

const utxoOf = (built: BuiltTransaction, index: number): Utxo => {
  const output = built.transaction.outputs[index];
  if (output === undefined) throw new Error(`no output ${index}`);
  return { transactionHash: built.transactionHash, index, output };
};

const genesisOutputs = (state = initialState): Output[] => [
  controllerOutput(identity, state, 1_000n),
  { lockingBytecode: asset.lockingBytecode, valueSatoshis: 30_000n },
  { lockingBytecode: jar.lockingBytecode, valueSatoshis: 10_000n },
];

const buildGenesis = (outputs = genesisOutputs()): BuiltTransaction =>
  buildTransaction({
    inputs: [p2pkhInput(fundingUtxo, funder)],
    outputs,
    changeLockingBytecode: funderLocking,
    allowTokenBurn: false,
  });

describe('transaction builder', () => {
  it('refuses to destroy tokens held by the inputs', () => {
    const held: Utxo = {
      ...fundingUtxo,
      output: { ...fundingUtxo.output, token: { amount: 5n, category: new Uint8Array(32).fill(7) } },
    };
    expect(() => buildTransaction({ inputs: [p2pkhInput(held, funder)], outputs: [], changeLockingBytecode: funderLocking })).toThrow(/Tokens/);
  });

  it('sets the fee from the size and returns the rest as change', () => {
    const built = accepted(
      buildTransaction({ inputs: [p2pkhInput(fundingUtxo, funder)], outputs: [], changeLockingBytecode: funderLocking, feeRate: 2 }),
    );
    expect(built.feeSatoshis).toBe(BigInt(built.encoded.length * 2));
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(100_000n - built.feeSatoshis);
    expect(built.changeIndex).toBe(0);
  });

  it('refuses to overspend or to pay an excessive fee', () => {
    const tooMuch: Output = { lockingBytecode: funderLocking, valueSatoshis: 100_000n };
    expect(() => buildTransaction({ inputs: [p2pkhInput(fundingUtxo, funder)], outputs: [tooMuch] })).toThrow(/Insufficient/);
    const tooLittle: Output = { lockingBytecode: funderLocking, valueSatoshis: 50_000n };
    expect(() => buildTransaction({ inputs: [p2pkhInput(fundingUtxo, funder)], outputs: [tooLittle] })).toThrow(/exceeds the maximum/);
  });

  it('leaves out change below the dust limit', () => {
    const nearlyAll: Output = { lockingBytecode: funderLocking, valueSatoshis: 99_500n };
    const built = accepted(
      buildTransaction({ inputs: [p2pkhInput(fundingUtxo, funder)], outputs: [nearlyAll], changeLockingBytecode: funderLocking }),
    );
    expect(built.transaction.outputs.length).toBe(1);
    expect(built.changeIndex).toBeUndefined();
  });
});

describe('identity genesis', () => {
  it('accepts a well-formed genesis', () => {
    const built = accepted(buildGenesis());
    const snapshot = validateGenesis(built.transaction, built.transactionHash, identity);
    expect(snapshot.state).toEqual(initialState);
    expect(snapshot.utxo.index).toBe(0);
    expect(snapshot.identity).toEqual(identity);
  });

  const rejects = (outputs: Output[], allowTokenBurn = false): void => {
    const built = buildTransaction({
      inputs: [p2pkhInput(fundingUtxo, funder)],
      outputs,
      changeLockingBytecode: funderLocking,
      allowTokenBurn,
    });
    expect(() => validateGenesis(built.transaction, built.transactionHash, identity)).toThrow();
  };
  const controller = controllerOutput(identity, initialState, 1_000n);
  const token = controller.token as NonNullable<Output['token']>;
  const nft = token.nft as NonNullable<typeof token.nft>;

  it('rejects a genesis that also keeps a minting token', () => {
    rejects([controller, { lockingBytecode: funderLocking, valueSatoshis: 1_000n, token: { ...token, nft: { ...nft, capability: 'minting' } } }]);
  });

  it('rejects a second identity token or extra fungible tokens', () => {
    rejects([controller, controller]);
    rejects([controller, { lockingBytecode: funderLocking, valueSatoshis: 1_000n, token: { amount: 10n, category: identity } }]);
    rejects([{ ...controller, token: { ...token, amount: 10n } }]);
  });

  it('rejects an identity token with minting or no capability', () => {
    rejects([{ ...controller, token: { ...token, nft: { ...nft, capability: 'minting' } } }]);
    rejects([{ ...controller, token: { ...token, nft: { ...nft, capability: 'none' } } }]);
  });

  it('rejects an identity token outside the controller script', () => {
    rejects([{ ...controller, lockingBytecode: funderLocking }]);
    rejects([{ ...controller, lockingBytecode: asset.lockingBytecode }]);
  });

  it('rejects an invalid, pending, or advanced initial state', () => {
    rejects([{ ...controller, token: { ...token, nft: { ...nft, commitment: Uint8Array.of(1, 2, 3) } } }]);
    rejects([controllerOutput(identity, { ...initialState, status: 'pending', proposedOwnerKeyHash: replacement.keyHash }, 1_000n)]);
    rejects([controllerOutput(identity, { ...initialState, ownerEpoch: 4 }, 1_000n)]);
  });

  it('rejects a transaction with no identity token, or for a different identity', () => {
    rejects([]);
    const built = buildGenesis();
    expect(() => validateGenesis(built.transaction, built.transactionHash, new Uint8Array(32).fill(9))).toThrow(
      IdentityValidationError,
    );
  });

  it('rejects a later transaction presented as the genesis', () => {
    const genesis = buildGenesis();
    const snapshot = validateGenesis(genesis.transaction, genesis.transactionHash, identity);
    const action: ControllerAction = { kind: 'ownerAuthorize' };
    const later = buildTransaction({
      inputs: [controllerInput(snapshot.utxo, snapshot.state, action, owner), protectedInput(utxoOf(genesis, 1), asset)],
      outputs: [controllerSuccessor(snapshot.utxo, snapshot.state, action)],
      changeLockingBytecode: asset.lockingBytecode,
    });
    expect(() => validateGenesis(later.transaction, later.transactionHash, identity)).toThrow(/does not create/);
  });
});

describe('wallet lifecycle built with the transaction builder', () => {
  it('creates a wallet, spends, survives a cancelled claim, recovers, and spends with the new key', () => {
    const genesis = accepted(buildGenesis());
    let controller: ControllerSnapshot = validateGenesis(genesis.transaction, genesis.transactionHash, identity);
    let assetUtxo = utxoOf(genesis, 1);
    const jarUtxo = utxoOf(genesis, 2);
    let funderUtxo = utxoOf(genesis, 3);
    const kinds: string[] = [];

    const advance = (built: BuiltTransaction): void => {
      const transition = followController(controller, built.transaction, built.transactionHash);
      kinds.push(transition.kind);
      controller = transition;
    };

    const ownerSpends = (key: KeyPair, extra: { input: ReturnType<typeof protectedInput>; locktime?: number }[] = []): BuiltTransaction => {
      const action: ControllerAction = { kind: 'ownerAuthorize' };
      const built = buildTransaction({
        inputs: [
          controllerInput(controller.utxo, controller.state, action, key),
          protectedInput(assetUtxo, asset),
          ...extra.map(({ input }) => input),
        ],
        outputs: [
          controllerSuccessor(controller.utxo, controller.state, action),
          { lockingBytecode: funderLocking, valueSatoshis: 2_000n },
        ],
        changeLockingBytecode: asset.lockingBytecode,
        ...(extra[0]?.locktime === undefined ? {} : { locktime: extra[0].locktime }),
      });
      return built;
    };

    const recovererActs = (action: ControllerAction): BuiltTransaction =>
      buildTransaction({
        inputs: [controllerInput(controller.utxo, controller.state, action, recoverer), p2pkhInput(funderUtxo, funder)],
        outputs: [controllerSuccessor(controller.utxo, controller.state, action)],
        changeLockingBytecode: funderLocking,
      });

    // Owner pays someone; change returns to the wallet.
    let built = accepted(ownerSpends(owner));
    advance(built);
    assetUtxo = utxoOf(built, 2);

    // Recoverer opens a claim, paying the fee from its own funds.
    built = accepted(recovererActs({ kind: 'requestRecovery', proposedOwnerKeyHash: replacement.keyHash }));
    advance(built);
    funderUtxo = utxoOf(built, 1);
    expect(built.transaction.outputs[0]?.valueSatoshis).toBe(1_000n);

    // Owner spends, which cancels the claim.
    built = accepted(ownerSpends(owner));
    advance(built);
    assetUtxo = utxoOf(built, 2);
    expect(controller.state.status).toBe('active');

    // Recoverer claims again and completes after the delay.
    built = accepted(recovererActs({ kind: 'requestRecovery', proposedOwnerKeyHash: replacement.keyHash }));
    advance(built);
    funderUtxo = utxoOf(built, 1);
    built = accepted(recovererActs({ kind: 'finalizeRecovery' }));
    expect(built.transaction.inputs[0]?.sequenceNumber).toBe(0x400001);
    advance(built);
    expect(controller.state.ownerKeyHash).toEqual(replacement.keyHash);
    expect(controller.state.ownerEpoch).toBe(1);

    // The old key no longer works; the replacement key spends the same asset output and the jar.
    expect(verifyTransaction(ownerSpends(owner))).toBeTypeOf('string');
    built = accepted(
      ownerSpends(replacement, [{ input: protectedInput(jarUtxo, jar), locktime: UNLOCK_TIME }]),
    );
    advance(built);

    expect(kinds).toEqual([
      'ownerAuthorize',
      'requestRecovery',
      'ownerAuthorize',
      'requestRecovery',
      'finalizeRecovery',
      'ownerAuthorize',
    ]);
  });

  it('names an owner update when following the controller', () => {
    const genesis = buildGenesis();
    const controller = validateGenesis(genesis.transaction, genesis.transactionHash, identity);
    const action: ControllerAction = { kind: 'ownerUpdate', update: { ownerKeyHash: replacement.keyHash } };
    const built = accepted(
      buildTransaction({
        inputs: [controllerInput(controller.utxo, controller.state, action, owner), p2pkhInput(utxoOf(genesis, 3), funder)],
        outputs: [controllerSuccessor(controller.utxo, controller.state, action)],
        changeLockingBytecode: funderLocking,
      }),
    );
    const transition = followController(controller, built.transaction, built.transactionHash);
    expect(transition.kind).toBe('ownerUpdate');
    expect(transition.state.ownerEpoch).toBe(1);
    expect(() => followController(transition, built.transaction, built.transactionHash)).toThrow(IdentityValidationError);
  });
});
