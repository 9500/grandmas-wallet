import {
  type Output,
  binToHex,
  decodeTransactionBch,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import {
  type BuiltTransaction,
  type ControllerAction,
  type ControllerState,
  type InputSpec,
  type KeyPair,
  type ProtectedScript,
  type Utxo,
  assetScript,
  buildTransaction,
  controllerInput,
  controllerScript,
  controllerOutput,
  controllerSuccessor,
  decodeControllerState,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  protectedInput,
  savingsJarScript,
  validateGenesis,
  verifyTransaction,
} from '@grandmas-wallet/core';

import type { BroadcastResult, UnspentEntry } from './electrum.js';
import { type Role, type RunState, type StepRecord, applyTransaction, toStored, toUtxo } from './store.js';

/** What the run needs from the network. */
export interface Chain {
  listUnspent: (lockingBytecode: Uint8Array) => Promise<UnspentEntry[]>;
  getTransaction: (transactionId: string) => Promise<string | undefined>;
  broadcast: (transactionHex: string) => Promise<BroadcastResult>;
}

/** What the run needs from its surroundings; replaceable for testing. */
export interface Environment {
  persist: (state: RunState) => void;
  sleep: (milliseconds: number) => Promise<void>;
  /** Milliseconds since the Unix epoch. */
  now: () => number;
  log: (message: string) => void;
}

export const ADDRESS_PREFIX = 'bchtest';

const CONTROLLER_VALUE = 1_000n;
const ASSET_VALUE = 15_000n;
const JAR_VALUE = 5_000n;
const PAYMENT_VALUE = 1_000n;
export const MINIMUM_FUNDING = 25_000n;
/** Mainnet-style challenge delay: one 512-second interval. */
export const CHALLENGE_DELAY = { unit: 'time512', value: 1 } as const;
const JAR_LOCK_SECONDS = 300;
const RETRY_INTERVAL_MS = 30_000;
const RETRY_LIMIT_MS = 90 * 60_000;

export const addressOf = (lockingBytecode: Uint8Array): string => {
  const result = lockingBytecodeToCashAddress({ prefix: ADDRESS_PREFIX, bytecode: lockingBytecode });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

const decode = (transactionHex: string) => {
  const transaction = decodeTransactionBch(hexToBin(transactionHex));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};

const isNotYetFinal = (reason: string): boolean => /non-?final|bip68/i.test(reason);
const isAlreadyKnown = (reason: string): boolean => /already/i.test(reason);

export class Run {
  readonly funder: KeyPair;
  readonly owner: KeyPair;
  readonly recoverer: KeyPair;
  readonly replacement: KeyPair;
  readonly funderLocking: Uint8Array;

  constructor(
    readonly state: RunState,
    readonly chain: Chain,
    readonly env: Environment,
  ) {
    const key = (hex: string): KeyPair => keyPairFromPrivateKey(hexToBin(hex));
    this.funder = key(state.keys.funder);
    this.owner = key(state.keys.owner);
    this.recoverer = key(state.keys.recoverer);
    this.replacement = key(state.keys.replacement);
    this.funderLocking = p2pkhLockingBytecode(this.funder.keyHash);
  }

  persist(): void {
    this.env.persist(this.state);
  }

  get identity(): Uint8Array {
    if (this.state.identity === undefined) throw new Error('The wallet identity has not been created yet.');
    return hexToBin(this.state.identity);
  }

  get asset(): ProtectedScript {
    return assetScript(this.identity);
  }

  get jar(): ProtectedScript {
    if (this.state.unlockTime === undefined) throw new Error('The Savings Jar has not been set up yet.');
    return savingsJarScript(this.identity, this.state.unlockTime);
  }

  /** Which of the run's scripts an output belongs to. */
  roleOf = (output: Output): Role | undefined => {
    if (sameBytes(output.lockingBytecode, this.funderLocking)) return output.token === undefined ? 'funder' : undefined;
    if (this.state.identity === undefined) return undefined;
    if (sameBytes(output.lockingBytecode, controllerScript(this.identity).lockingBytecode)) {
      return output.token !== undefined && sameBytes(output.token.category, this.identity) ? 'controller' : undefined;
    }
    if (sameBytes(output.lockingBytecode, this.asset.lockingBytecode)) return 'asset';
    if (this.state.unlockTime !== undefined && sameBytes(output.lockingBytecode, this.jar.lockingBytecode)) return 'jar';
    return undefined;
  };

  utxos(role: Role): Utxo[] {
    return this.state.utxos.filter((utxo) => utxo.role === role).map(toUtxo);
  }

  balance(role: Role): bigint {
    return this.utxos(role).reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  controller(): { utxo: Utxo; state: ControllerState } {
    const [utxo] = this.utxos('controller');
    const commitment = utxo?.output.token?.nft?.commitment;
    if (utxo === undefined || commitment === undefined) throw new Error('No controller output is tracked.');
    return { utxo, state: decodeControllerState(commitment) };
  }

  /** The key that currently owns the wallet, according to the controller state. */
  currentOwner(): KeyPair {
    const { state } = this.controller();
    const match = [this.owner, this.replacement].find((key) => sameBytes(key.keyHash, state.ownerKeyHash));
    if (match === undefined) throw new Error('The controller names an owner this run has no key for.');
    return match;
  }

  funderInputs(): InputSpec[] {
    return this.utxos('funder').map((utxo) => p2pkhInput(utxo, this.funder));
  }

  /** Add funder outputs the server knows about that are not tracked yet. */
  async syncFunder(): Promise<void> {
    for (const entry of await this.chain.listUnspent(this.funderLocking)) {
      const tracked = this.state.utxos.some(
        (utxo) => utxo.transactionId === entry.transactionId && utxo.index === entry.index,
      );
      if (tracked || entry.hasToken) continue;
      const hex = await this.chain.getTransaction(entry.transactionId);
      const output = hex === undefined ? undefined : decode(hex).outputs[entry.index];
      if (output === undefined) throw new Error(`Cannot read funding output ${entry.transactionId}:${entry.index}.`);
      this.state.utxos.push(toStored('funder', entry.transactionId, entry.index, output));
    }
    this.persist();
  }

  private record(name: string, record: StepRecord): void {
    if (!this.state.stepOrder.includes(name)) this.state.stepOrder.push(name);
    this.state.steps[name] = record;
    this.persist();
  }

  private complete(name: string, record: StepRecord): void {
    applyTransaction(this.state, decode(record.transactionHex), record.transactionId, this.roleOf);
    this.record(name, { ...record, status: 'done', at: new Date(this.env.now()).toISOString() });
    this.env.log(`  done   ${name}  ${record.transactionId}`);
  }

  /**
   * Run a step whose transaction must be accepted. The transaction is checked
   * locally and saved before it is sent, so an interrupted step is resumed
   * with the same transaction instead of being built again.
   */
  async accept(
    name: string,
    description: string,
    build: () => BuiltTransaction,
    options: { waitUntilFinal?: boolean } = {},
  ): Promise<void> {
    let record = this.state.steps[name];
    if (record?.status === 'done') {
      this.env.log(`  skip   ${name} (already done)`);
      return;
    }
    if (record === undefined) {
      const built = build();
      const check = verifyTransaction(built);
      if (check !== true) throw new Error(`Step "${name}" built a transaction that fails the local check: ${check}`);
      record = {
        status: 'pending',
        description,
        transactionId: built.transactionId,
        transactionHex: binToHex(built.encoded),
        at: new Date(this.env.now()).toISOString(),
        note: `fee ${built.feeSatoshis} sat`,
      };
      this.record(name, record);
    } else if ((await this.chain.getTransaction(record.transactionId)) !== undefined) {
      this.complete(name, record);
      return;
    }

    const deadline = this.env.now() + RETRY_LIMIT_MS;
    let announced = false;
    for (;;) {
      const result = await this.chain.broadcast(record.transactionHex);
      if (result.accepted || isAlreadyKnown(result.reason)) {
        this.complete(name, record);
        return;
      }
      if (options.waitUntilFinal === true && isNotYetFinal(result.reason) && this.env.now() < deadline) {
        if (!announced) this.env.log(`  wait   ${name}: not yet valid on chain (${result.reason}); retrying every 30 s`);
        announced = true;
        await this.env.sleep(RETRY_INTERVAL_MS);
        continue;
      }
      throw new Error(`Step "${name}" was refused by the network: ${result.reason}`);
    }
  }

  /** Run a step whose transaction must be refused by the network. */
  async refuse(name: string, description: string, build: () => BuiltTransaction): Promise<void> {
    if (this.state.steps[name] !== undefined) {
      this.env.log(`  skip   ${name} (already recorded)`);
      return;
    }
    const built = build();
    const localCheck = verifyTransaction(built);
    const result = await this.chain.broadcast(binToHex(built.encoded));
    const record: StepRecord = {
      status: result.accepted ? 'ACCEPTED-UNEXPECTEDLY' : 'refused-as-expected',
      description,
      transactionId: built.transactionId,
      transactionHex: binToHex(built.encoded),
      at: new Date(this.env.now()).toISOString(),
      localCheck: localCheck === true ? 'passes (only chain time can refuse it)' : localCheck,
      networkReply: result.accepted ? 'accepted' : result.reason,
    };
    if (result.accepted) {
      applyTransaction(this.state, built.transaction, built.transactionId, this.roleOf);
      this.record(name, record);
      throw new Error(`SECURITY FINDING: "${name}" should have been refused but was accepted (${built.transactionId}).`);
    }
    this.record(name, record);
    this.env.log(`  refused ${name}: ${result.reason}`);
  }

  /** A controller action by the recoverer, with fees paid from the recoverer's own funds. */
  recovererAction(action: ControllerAction, extraInputs: InputSpec[] = []): BuiltTransaction {
    const { utxo, state } = this.controller();
    return buildTransaction({
      inputs: [controllerInput(utxo, state, action, this.recoverer), ...this.funderInputs(), ...extraInputs],
      outputs: [controllerSuccessor(utxo, state, action)],
      changeLockingBytecode: this.funderLocking,
    });
  }

  /** An owner-approved spend of wallet assets. Change returns to the wallet unless redirected. */
  ownerSpend(
    key: KeyPair,
    options: { payments?: Output[]; jar?: boolean; allAssets?: boolean; changeLockingBytecode?: Uint8Array } = {},
  ): BuiltTransaction {
    const { utxo, state } = this.controller();
    const action: ControllerAction = { kind: 'ownerAuthorize' };
    const assets = this.utxos('asset');
    const chosen = options.allAssets === true ? assets : assets.slice(0, 1);
    const jars = options.jar === true ? this.utxos('jar') : [];
    return buildTransaction({
      inputs: [
        controllerInput(utxo, state, action, key),
        ...chosen.map((asset) => protectedInput(asset, this.asset)),
        ...jars.map((jar) => protectedInput(jar, this.jar)),
      ],
      outputs: [controllerSuccessor(utxo, state, action), ...(options.payments ?? [])],
      changeLockingBytecode: options.changeLockingBytecode ?? this.asset.lockingBytecode,
      ...(jars.length > 0 && this.state.unlockTime !== undefined ? { locktime: this.state.unlockTime } : {}),
    });
  }
}

/** Name for a repeatable step: the unfinished one of that kind if there is one, otherwise the next number. */
export const numbered = (state: RunState, prefix: string): string => {
  const used = state.stepOrder.filter((name) => name.startsWith(prefix));
  const last = used[used.length - 1];
  return last !== undefined && state.steps[last]?.status === 'pending' ? last : `${prefix}-${used.length + 1}`;
};

/** The full lifecycle. Every step is skipped if already done, so this can be run again after an interruption. */
export const runLifecycle = async (run: Run): Promise<void> => {
  const { state } = run;
  if (state.steps['prepare'] === undefined) {
    await run.syncFunder();
    if (run.balance('funder') < MINIMUM_FUNDING) {
      throw new Error(`Funding address holds ${run.balance('funder')} sat; at least ${MINIMUM_FUNDING} is needed.`);
    }
  }

  run.env.log('Creating the wallet');
  await run.accept('prepare', 'Funds gathered into one output that can create the identity', () =>
    buildTransaction({ inputs: run.funderInputs(), outputs: [], changeLockingBytecode: run.funderLocking }),
  );
  if (state.identity === undefined) {
    // The identity is the hash of the transaction whose first output the genesis spends.
    const prepared = state.steps['prepare'];
    if (prepared === undefined) throw new Error('Prepare step missing.');
    state.identity = prepared.transactionId;
    state.unlockTime = Math.floor(run.env.now() / 1000) + JAR_LOCK_SECONDS;
    run.persist();
  }
  const initialState: ControllerState = {
    version: 1,
    status: 'active',
    ownerEpoch: 0,
    ownerKeyHash: run.owner.keyHash,
    recovererKeyHash: run.recoverer.keyHash,
    challengeDelay: CHALLENGE_DELAY,
  };
  await run.accept('genesis', 'Wallet identity, controller, funds and a Savings Jar created', () =>
    buildTransaction({
      inputs: run.funderInputs(),
      outputs: [
        controllerOutput(run.identity, initialState, CONTROLLER_VALUE),
        { lockingBytecode: run.asset.lockingBytecode, valueSatoshis: ASSET_VALUE },
        { lockingBytecode: run.jar.lockingBytecode, valueSatoshis: JAR_VALUE },
      ],
      changeLockingBytecode: run.funderLocking,
    }),
  );
  const genesis = state.steps['genesis'];
  if (genesis === undefined) throw new Error('Genesis step missing.');
  validateGenesis(decode(genesis.transactionHex), hexToBin(genesis.transactionId), run.identity);
  run.env.log(`  identity ${state.identity}`);
  run.env.log(`  wallet address ${addressOf(run.asset.lockingBytecode)}`);

  const payment: Output = { lockingBytecode: run.funderLocking, valueSatoshis: PAYMENT_VALUE };
  const claim: ControllerAction = { kind: 'requestRecovery', proposedOwnerKeyHash: run.replacement.keyHash };

  run.env.log('Normal use');
  await run.accept('owner-send', 'Owner pays from the wallet without the recoverer (C01)', () =>
    run.ownerSpend(run.owner, { payments: [payment] }),
  );

  run.env.log('Recovery claim, challenged by the owner');
  await run.refuse('attack-claim-with-spend', 'Recoverer tries to take wallet funds in the claim transaction (C07)', () =>
    run.recovererAction(claim, [protectedInput(run.utxos('asset')[0] as Utxo, run.asset)]),
  );
  await run.accept('claim-1', 'Recoverer opens a recovery claim, paying its own fee', () => run.recovererAction(claim));
  await run.refuse('attack-early-finalize', 'Recoverer tries to complete recovery before the delay (C03)', () =>
    run.recovererAction({ kind: 'finalizeRecovery' }),
  );
  await run.accept('cancel', 'Owner cancels the claim (C05)', () => run.ownerSpend(run.owner));

  run.env.log('Recovery after an unchallenged delay');
  await run.accept('claim-2', 'Recoverer opens a second claim', () => run.recovererAction(claim));
  await run.accept(
    'finalize',
    'Recoverer completes recovery after the delay; the replacement key becomes owner (C11)',
    () => run.recovererAction({ kind: 'finalizeRecovery' }),
    { waitUntilFinal: true },
  );

  run.env.log('After recovery');
  await run.refuse('attack-old-owner-spend', 'Old owner key tries to spend after recovery (C12)', () =>
    run.ownerSpend(run.owner, { payments: [payment] }),
  );
  await run.accept('new-owner-send', 'Replacement key pays from the same wallet outputs', () =>
    run.ownerSpend(run.replacement, { payments: [payment] }),
  );
  await run.accept(
    'jar-withdraw',
    'Replacement key withdraws the Savings Jar after its unlock time, without it having moved',
    () => run.ownerSpend(run.replacement, { jar: true }),
    { waitUntilFinal: true },
  );

};

/** Return everything that can be returned to `destination`. The controller output itself stays on chain. */
export const sweepAll = async (run: Run, destination: Uint8Array): Promise<void> => {
  const { state } = run;
  await run.syncFunder();
  if (state.identity !== undefined && run.utxos('asset').length + run.utxos('jar').length > 0) {
    const owner = run.currentOwner();
    const jarOpen = state.unlockTime !== undefined && run.env.now() / 1000 > state.unlockTime + 3_600;
    if (run.utxos('jar').length > 0 && !jarOpen) {
      run.env.log('The Savings Jar is still locked (or only just unlocked); it is left in place. Sweep again in an hour.');
    }
    if (run.utxos('asset').length > 0 || jarOpen) {
      await run.accept(numbered(state, 'sweep-wallet'), 'Wallet funds returned', () =>
        run.ownerSpend(owner, { allAssets: true, jar: jarOpen, changeLockingBytecode: destination }),
      );
    }
  }
  if (run.utxos('funder').length > 0) {
    await run.accept(numbered(state, 'sweep-funder'), 'Funding address returned', () =>
      buildTransaction({ inputs: run.funderInputs(), outputs: [], changeLockingBytecode: destination }),
    );
  }
};
