import { type Output, binToHex, decodeTransactionBch, hexToBin, lockingBytecodeToCashAddress, sha256 } from '@bitauth/libauth';
import {
  type AddressKind,
  type BuiltTransaction,
  type ControllerAction,
  type ControllerState,
  type HistoryEntry,
  type InputSpec,
  type KeyPair,
  type RecoverableAddressScript,
  type UnspentOutputEntry,
  type Utxo,
  type VaultAddressScript,
  ADDRESS_KIND,
  addressSecret,
  addressTag,
  buildTransaction,
  checkBeforeSending,
  controllerInput,
  controllerOutput,
  controllerScript,
  controllerSuccessor,
  decodeControllerState,
  keyPairFromPrivateKey,
  p2pkhInput,
  p2pkhLockingBytecode,
  readControllerHistory,
  recoverableAddressScript,
  recoverableInput,
  sweptInput,
  validateGenesis,
  vaultAddressScript,
  vaultInput,
  verifyTransaction,
} from '@grandmas-wallet/core';

import type { BroadcastResult } from './electrum.js';
import { type AddressPlace, type Role, type RunState, type SeedName, type StepRecord, type StoredUtxo, applyTransaction, toStored, toUtxo } from './store.js';

/**
 * The scripted run of the two addresses and the controller: one wallet's life from its creation to its
 * closing, with the transactions the network must refuse along the way.
 *
 * The same script runs on the simulated chain, on the local node and on chipnet; only the `Chain` and the
 * `Environment` it is given differ. Every step is saved before and after it is sent, so a run that stops
 * continues from where it stopped.
 */

/** What the run needs from the network. */
export interface Chain {
  listUnspent: (lockingBytecode: Uint8Array) => Promise<UnspentOutputEntry[]>;
  getTransaction: (transactionId: string) => Promise<string | undefined>;
  getHistory: (lockingBytecode: Uint8Array) => Promise<HistoryEntry[]>;
  broadcast: (transactionHex: string) => Promise<BroadcastResult>;
}

/** What the run needs from its surroundings; replaceable for testing. */
export interface Environment {
  persist: (state: RunState) => void;
  /** Let time pass. On a chain whose clock the run controls, this moves that clock. */
  sleep: (milliseconds: number) => Promise<void>;
  /** Milliseconds since the Unix epoch, by the clock that `sleep` moves. */
  now: () => number;
  log: (message: string) => void;
  /** How long to wait between attempts while a time lock has not passed. 30 seconds unless given. */
  retryIntervalMs?: number;
  /** Called when a step's transaction is saved and about to be sent. A test of resuming may stop the run here by throwing. */
  beforeSending?: (step: string) => void;
  /** Called when a step is done and recorded. A test of resuming may stop the run here by throwing. */
  afterStep?: (step: string) => void;
}

const CONTROLLER_VALUE = 1_000n;
/** What the wallet receives at each of its first addresses. */
const RECEIVED = { givenOutFirst: 6_000n, givenOutSecond: 3_000n, change: 3_000n, vault: 3_000n } as const;
const PAYMENT_VALUE = 1_000n;
/** What the owner gives the recoverer for fees: two requests and a completion, with a margin. */
const FEE_ALLOWANCE = 5_000n;
/** What the funding address must hold before the run starts. About 11,000 satoshis of it are spent on fees. */
export const MINIMUM_FUNDING = 30_000n;
/** The waiting period: one unit of 512 seconds. */
export const CHALLENGE_DELAY = { unit: 'time512', value: 1 } as const;
const DEFAULT_RETRY_INTERVAL_MS = 30_000;
const RETRY_LIMIT_MS = 90 * 60_000;
const CONFIRMATION_POLL_MS = 15_000;
const CONFIRMATION_LIMIT_MS = 30 * 60_000;
/** How many addresses of each kind, and how many vault addresses, the run recognises as its own for each seed. */
const ADDRESS_NUMBERS = 4;
const VAULT_NUMBERS = 2;

const SEEDS: SeedName[] = ['old', 'new'];

export const addressOf = (lockingBytecode: Uint8Array, prefix: string): string => {
  const result = lockingBytecodeToCashAddress({ prefix: prefix as 'bchtest', bytecode: lockingBytecode });
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

/** Why the network must refuse a transaction: because its time has not come, or because a script fails. */
export interface ExpectedRefusal {
  /** What the node's reply must contain. A reply of another kind, such as a lost connection, is not a refusal. */
  network: RegExp;
  /** The input whose script this project's own check must find failing, when a script is to refuse. */
  failingInput?: number;
}
export const REFUSED_BY_TIME: ExpectedRefusal = { network: /non-?BIP68-final/i };
export const refusedByScript = (failingInput: number): ExpectedRefusal => ({ network: /script/i, failingInput });

interface Seed {
  controllerKey: KeyPair;
  blindingSeed: Uint8Array;
  addressKeys: Uint8Array;
}

/** A recoverable address of the run: its place, its key, its secret and its script. */
export interface RunAddress {
  place: AddressPlace;
  key: KeyPair;
  secret: Uint8Array;
  script: RecoverableAddressScript;
}

/** A vault address of the run. */
export interface RunVault {
  place: AddressPlace;
  secret: Uint8Array;
  script: VaultAddressScript;
}

export class Run {
  readonly funder: KeyPair;
  readonly recoverer: KeyPair;
  readonly recovererFee: KeyPair;
  readonly seeds: Record<SeedName, Seed>;
  readonly funderLocking: Uint8Array;
  readonly feeLocking: Uint8Array;
  private places: Map<string, AddressPlace> | undefined;

  constructor(
    readonly state: RunState,
    readonly chain: Chain,
    readonly env: Environment,
  ) {
    const key = (hex: string): KeyPair => keyPairFromPrivateKey(hexToBin(hex));
    const seed = (name: SeedName): Seed => ({
      controllerKey: key(state.keys[name].controllerKey),
      blindingSeed: hexToBin(state.keys[name].blindingSeed),
      addressKeys: hexToBin(state.keys[name].addressKeys),
    });
    this.funder = key(state.keys.funder);
    this.recoverer = key(state.keys.recoverer);
    this.recovererFee = key(state.keys.recovererFee);
    this.seeds = { old: seed('old'), new: seed('new') };
    this.funderLocking = p2pkhLockingBytecode(this.funder.keyHash);
    this.feeLocking = p2pkhLockingBytecode(this.recovererFee.keyHash);
  }

  persist(): void {
    this.env.persist(this.state);
  }

  get identity(): Uint8Array {
    if (this.state.identity === undefined) throw new Error('The wallet identity has not been created yet.');
    return hexToBin(this.state.identity);
  }

  /**
   * The key of one address. The run holds one random value for each seed and makes each address key from
   * it; the wallet's own key tree takes the place of this.
   */
  private addressKey(seed: SeedName, kind: AddressKind, number: number): KeyPair {
    const numberBytes = Uint8Array.of(number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, (number >> 24) & 0xff);
    return keyPairFromPrivateKey(sha256.hash(Uint8Array.from([...this.seeds[seed].addressKeys, kind, ...numberBytes])));
  }

  /** Recoverable address `number` of a kind, of one of the run's seeds. */
  address(seed: SeedName, kind: typeof ADDRESS_KIND.givenOut | typeof ADDRESS_KIND.change, number: number): RunAddress {
    const key = this.addressKey(seed, kind, number);
    const secret = addressSecret(this.seeds[seed].blindingSeed, kind, number);
    return { place: { seed, kind, number }, key, secret, script: recoverableAddressScript(addressTag(this.identity, secret), key.keyHash) };
  }

  vault(seed: SeedName, number: number): RunVault {
    const secret = addressSecret(this.seeds[seed].blindingSeed, ADDRESS_KIND.vault, number);
    return { place: { seed, kind: ADDRESS_KIND.vault, number }, secret, script: vaultAddressScript(addressTag(this.identity, secret)) };
  }

  /** Every address the run recognises as its own, by locking bytecode. */
  private knownPlaces(): Map<string, AddressPlace> {
    if (this.places === undefined) {
      const places = new Map<string, AddressPlace>();
      for (const seed of SEEDS) {
        for (const kind of [ADDRESS_KIND.givenOut, ADDRESS_KIND.change]) {
          for (let number = 0; number < ADDRESS_NUMBERS; number++) {
            const { place, script } = this.address(seed, kind, number);
            places.set(binToHex(script.lockingBytecode), place);
          }
        }
        for (let number = 0; number < VAULT_NUMBERS; number++) {
          const { place, script } = this.vault(seed, number);
          places.set(binToHex(script.lockingBytecode), place);
        }
      }
      this.places = places;
    }
    return this.places;
  }

  /** The locking bytecode of every script the run may hold coins at, with a name for each. */
  everyScript(): { name: string; lockingBytecode: Uint8Array }[] {
    const scripts = [
      { name: 'funding address', lockingBytecode: this.funderLocking },
      { name: 'recoverer\'s fee address', lockingBytecode: this.feeLocking },
    ];
    if (this.state.identity === undefined) return scripts;
    scripts.push({ name: 'controller', lockingBytecode: controllerScript(this.identity).lockingBytecode });
    for (const [lockingBytecode, place] of this.knownPlaces()) {
      const kind = place.kind === ADDRESS_KIND.vault ? 'vault' : place.kind === ADDRESS_KIND.change ? 'change' : 'given out';
      scripts.push({ name: `${place.seed} seed, ${kind} ${place.number}`, lockingBytecode: hexToBin(lockingBytecode) });
    }
    return scripts;
  }

  /** What an output is to the run, if anything. */
  roleOf = (output: Output): { role: Role; place?: AddressPlace } | undefined => {
    if (sameBytes(output.lockingBytecode, this.funderLocking)) return output.token === undefined ? { role: 'funder' } : undefined;
    if (sameBytes(output.lockingBytecode, this.feeLocking)) return output.token === undefined ? { role: 'fee' } : undefined;
    if (this.state.identity === undefined) return undefined;
    if (sameBytes(output.lockingBytecode, controllerScript(this.identity).lockingBytecode)) {
      return output.token !== undefined && sameBytes(output.token.category, this.identity) ? { role: 'controller' } : undefined;
    }
    const place = this.knownPlaces().get(binToHex(output.lockingBytecode));
    return place === undefined ? undefined : { role: 'address', place };
  };

  stored(role: Role): StoredUtxo[] {
    return this.state.utxos.filter((utxo) => utxo.role === role);
  }

  utxos(role: Role): Utxo[] {
    return this.stored(role).map(toUtxo);
  }

  balance(role: Role): bigint {
    return this.utxos(role).reduce((sum, { output }) => sum + output.valueSatoshis, 0n);
  }

  /** The coins at addresses of a seed: at recoverable addresses, or at vault addresses. */
  coins(seed: SeedName, where: 'recoverable' | 'vault'): StoredUtxo[] {
    return this.stored('address').filter(
      ({ place }) => place !== undefined && place.seed === seed && (place.kind === ADDRESS_KIND.vault) === (where === 'vault'),
    );
  }

  /** The one coin at a recoverable address of the run. */
  coinAt(seed: SeedName, kind: typeof ADDRESS_KIND.givenOut | typeof ADDRESS_KIND.change, number: number): StoredUtxo {
    const found = this.stored('address').find(({ place }) => place !== undefined && place.seed === seed && place.kind === kind && place.number === number);
    if (found === undefined) throw new Error(`No coin is tracked at address ${number} of kind ${kind} of the ${seed} seed.`);
    return found;
  }

  /** A coin at a recoverable address, spent by the key the address was made for. */
  byKey(stored: StoredUtxo): InputSpec {
    const { place } = stored;
    if (place === undefined || place.kind === ADDRESS_KIND.vault) throw new Error('Only a coin at a recoverable address is spent by a key.');
    const { script, key } = this.address(place.seed, place.kind, place.number);
    return recoverableInput(toUtxo(stored), script, key);
  }

  /** A coin released through the controller: a swept coin, or a coin at a vault address. */
  throughController(stored: StoredUtxo): InputSpec {
    const { place } = stored;
    if (place === undefined) throw new Error('Only a coin at an address of the wallet is released through the controller.');
    if (place.kind === ADDRESS_KIND.vault) {
      const { script, secret } = this.vault(place.seed, place.number);
      return vaultInput(toUtxo(stored), script, this.identity, secret);
    }
    const { script, secret } = this.address(place.seed, place.kind, place.number);
    return sweptInput(toUtxo(stored), script, this.identity, secret);
  }

  controller(): { utxo: Utxo; state: ControllerState } {
    const [utxo] = this.utxos('controller');
    const commitment = utxo?.output.token?.nft?.commitment;
    if (utxo === undefined || commitment === undefined) throw new Error('No controller output is tracked.');
    return { utxo, state: decodeControllerState(commitment) };
  }

  /** The seed whose controller key currently owns the wallet, according to the controller state. */
  currentOwner(): SeedName {
    const { state } = this.controller();
    const match = SEEDS.find((seed) => sameBytes(this.seeds[seed].controllerKey.keyHash, state.ownerKeyHash));
    if (match === undefined) throw new Error('The controller names an owner this run has no key for.');
    return match;
  }

  funderInputs(): InputSpec[] {
    return this.utxos('funder').map((utxo) => p2pkhInput(utxo, this.funder));
  }

  feeInputs(): InputSpec[] {
    return this.utxos('fee').map((utxo) => p2pkhInput(utxo, this.recovererFee));
  }

  /** Add outputs at the funding address that the server knows about and the run does not track yet. */
  async syncFunder(): Promise<void> {
    for (const entry of await this.chain.listUnspent(this.funderLocking)) {
      const tracked = this.state.utxos.some((utxo) => utxo.transactionId === entry.transactionId && utxo.index === entry.index);
      if (tracked || entry.hasToken) continue;
      const hex = await this.chain.getTransaction(entry.transactionId);
      const output = hex === undefined ? undefined : decode(hex).outputs[entry.index];
      if (output === undefined) throw new Error(`Cannot read funding output ${entry.transactionId}:${entry.index}.`);
      this.state.utxos.push(toStored({ role: 'funder' }, entry.transactionId, entry.index, output));
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
    this.env.log(`  done   ${name}  ${record.transactionId}  ${record.bytes} bytes, fee ${record.feeSatoshis}`);
    this.env.afterStep?.(name);
  }

  private static describe(built: BuiltTransaction): Pick<StepRecord, 'transactionId' | 'transactionHex' | 'bytes' | 'feeSatoshis' | 'requiredFeeSatoshis'> {
    return {
      transactionId: built.transactionId,
      transactionHex: binToHex(built.encoded),
      bytes: built.encoded.length,
      feeSatoshis: built.feeSatoshis.toString(),
      requiredFeeSatoshis: built.requiredFeeSatoshis.toString(),
    };
  }

  /**
   * Run a step whose transaction must be accepted. The transaction passes the check before sending and is
   * saved before it is sent, so an interrupted step is resumed with the same transaction instead of being
   * built again.
   */
  async accept(name: string, description: string, build: () => BuiltTransaction, options: { waitUntilFinal?: boolean } = {}): Promise<void> {
    let record = this.state.steps[name];
    if (record?.status === 'done') {
      this.env.log(`  skip   ${name} (already done)`);
      return;
    }
    if (record === undefined) {
      const built = build();
      const check = checkBeforeSending(built);
      if (check !== true) throw new Error(`Step "${name}" built a transaction that fails the check before sending: ${check}`);
      record = {
        status: 'pending',
        description,
        ...Run.describe(built),
        at: new Date(this.env.now()).toISOString(),
        ...(built.remainderSatoshis > 0n ? { note: `${built.remainderSatoshis} satoshis too small to return went to the fee` } : {}),
      };
      this.record(name, record);
    } else if ((await this.chain.getTransaction(record.transactionId)) !== undefined) {
      this.complete(name, record);
      return;
    }

    this.env.beforeSending?.(name);
    const deadline = this.env.now() + RETRY_LIMIT_MS;
    const interval = this.env.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    let announced = false;
    for (;;) {
      const result = await this.chain.broadcast(record.transactionHex);
      if (result.accepted || isAlreadyKnown(result.reason)) {
        this.complete(name, record);
        return;
      }
      if (options.waitUntilFinal === true && isNotYetFinal(result.reason) && this.env.now() < deadline) {
        if (!announced) this.env.log(`  wait   ${name}: not yet valid on chain (${oneLine(result.reason)}); trying again every ${Math.round(interval / 1000)} s`);
        announced = true;
        await this.env.sleep(interval);
        continue;
      }
      throw new Error(`Step "${name}" was refused by the network: ${result.reason}`);
    }
  }

  /**
   * Run a step whose transaction must be refused by the network, and for the reason given. Anything else —
   * an acceptance, a refusal for another reason, a reply that is no refusal at all — stops the run.
   */
  async refuse(name: string, description: string, build: () => BuiltTransaction, expected: ExpectedRefusal): Promise<void> {
    if (this.state.steps[name] !== undefined) {
      this.env.log(`  skip   ${name} (already recorded)`);
      return;
    }
    const built = build();
    const localCheck = verifyTransaction(built);
    if (expected.failingInput === undefined) {
      if (localCheck !== true) throw new Error(`Step "${name}" was to be refused by chain time alone, but fails this project's own check: ${localCheck}`);
    } else if (localCheck === true || !localCheck.includes(`input index ${expected.failingInput}`)) {
      throw new Error(`Step "${name}" was to fail at input ${expected.failingInput}; this project's own check says: ${String(localCheck)}`);
    }
    const result = await this.chain.broadcast(binToHex(built.encoded));
    const record: StepRecord = {
      status: result.accepted ? 'ACCEPTED-UNEXPECTEDLY' : 'refused-as-expected',
      description,
      ...Run.describe(built),
      at: new Date(this.env.now()).toISOString(),
      localCheck: localCheck === true ? 'passes (only chain time can refuse it)' : localCheck,
      networkReply: result.accepted ? 'accepted' : result.reason,
    };
    if (result.accepted) {
      applyTransaction(this.state, built.transaction, built.transactionId, this.roleOf);
      this.record(name, record);
      throw new Error(`SECURITY FINDING: "${name}" should have been refused but was accepted (${built.transactionId}).`);
    }
    if (!expected.network.test(result.reason)) {
      // Not recorded: the step is tried again when the run continues.
      throw new Error(`Step "${name}" was not refused for the reason it should be. The reply was: ${oneLine(result.reason)}`);
    }
    this.record(name, record);
    this.env.log(`  refused ${name}: ${oneLine(result.reason)}`);
  }

  /**
   * Bring the records in line with the chain after a stop: a step that was saved and whose transaction the
   * network has is completed; one whose transaction never went out is forgotten, so that the coins it
   * named are free again.
   */
  async settlePending(): Promise<void> {
    for (const name of [...this.state.stepOrder]) {
      const record = this.state.steps[name];
      if (record?.status !== 'pending') continue;
      if ((await this.chain.getTransaction(record.transactionId)) !== undefined) {
        this.complete(name, record);
      } else {
        const { [name]: _dropped, ...rest } = this.state.steps;
        this.state.steps = rest;
        this.state.stepOrder = this.state.stepOrder.filter((step) => step !== name);
        this.persist();
        this.env.log(`  dropped ${name}: its transaction was never sent`);
      }
    }
  }

  /** Wait until a step's transaction is in a block. The wallet gives out no address before its creation is. */
  async waitConfirmed(name: string): Promise<void> {
    const record = this.state.steps[name];
    if (record === undefined) throw new Error(`There is no step "${name}" to wait for.`);
    if (record.note?.includes('confirmed') === true) return;
    const lockingBytecode = controllerScript(this.identity).lockingBytecode;
    const deadline = this.env.now() + CONFIRMATION_LIMIT_MS;
    let announced = false;
    for (;;) {
      const history = await this.chain.getHistory(lockingBytecode);
      if (history.some((entry) => entry.transactionId === record.transactionId && entry.height > 0)) {
        this.record(name, { ...record, note: [record.note, 'confirmed before the next step'].filter((part) => part !== undefined).join('; ') });
        return;
      }
      if (this.env.now() > deadline) throw new Error(`Step "${name}" was not confirmed within ${CONFIRMATION_LIMIT_MS / 60_000} minutes.`);
      if (!announced) this.env.log(`  wait   ${name}: waiting for its first confirmation`);
      announced = true;
      await this.env.sleep(CONFIRMATION_POLL_MS);
    }
  }

  /** A controller action by the recoverer, with the fee paid from the recoverer's own fee address. */
  recovererAction(action: ControllerAction, attached: InputSpec[] = []): BuiltTransaction {
    const { utxo, state } = this.controller();
    return buildTransaction({
      inputs: [controllerInput(utxo, state, action, this.recoverer), ...this.feeInputs(), ...attached],
      outputs: [controllerSuccessor(utxo, state, action)],
      changeLockingBytecode: this.feeLocking,
    });
  }

  /**
   * A transaction that the owner approves through the controller. The controller continues unchanged; what
   * the other inputs hold, less the fee, goes to `remainderTo`.
   */
  ownerApproved(signer: KeyPair, inputs: InputSpec[], remainderTo: Uint8Array): BuiltTransaction {
    const { utxo, state } = this.controller();
    const action: ControllerAction = { kind: 'ownerAuthorize' };
    return buildTransaction({
      inputs: [controllerInput(utxo, state, action, signer), ...inputs],
      outputs: [controllerSuccessor(utxo, state, action), { lockingBytecode: remainderTo, valueSatoshis: 0n }],
      remainderOutputIndex: 1,
    });
  }

  /** The owner closes the wallet: the controller's value and the given coins go to one output. */
  closing(signer: KeyPair, inputs: InputSpec[], to: Uint8Array): BuiltTransaction {
    const { utxo, state } = this.controller();
    return buildTransaction({
      inputs: [controllerInput(utxo, state, { kind: 'ownerClose' }, signer), ...inputs],
      outputs: [{ lockingBytecode: to, valueSatoshis: 0n }],
      remainderOutputIndex: 0,
      allowTokenBurn: true,
    });
  }
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Name for a repeatable step: the unfinished one of that kind if there is one, otherwise the next number. */
export const numbered = (state: RunState, prefix: string): string => {
  const used = state.stepOrder.filter((name) => name.startsWith(prefix));
  const last = used[used.length - 1];
  return last !== undefined && state.steps[last]?.status === 'pending' ? last : `${prefix}-${used.length + 1}`;
};

/** The transaction that creates the wallet, or the self-payment before it: whichever the run sends first. */
const firstTransaction = (run: Run): { name: 'prepare' | 'create'; build: () => BuiltTransaction } => {
  if (run.state.identity === undefined) {
    return { name: 'prepare', build: () => buildTransaction({ inputs: run.funderInputs(), outputs: [{ lockingBytecode: run.funderLocking, valueSatoshis: 0n }], remainderOutputIndex: 0 }) };
  }
  const initialState: ControllerState = {
    version: 1,
    status: 'active',
    ownerEpoch: 0,
    ownerKeyHash: run.seeds.old.controllerKey.keyHash,
    recovererKeyHash: run.recoverer.keyHash,
    challengeDelay: CHALLENGE_DELAY,
  };
  return {
    name: 'create',
    build: () =>
      buildTransaction({
        inputs: run.funderInputs(),
        outputs: [controllerOutput(run.identity, initialState, CONTROLLER_VALUE)],
        changeLockingBytecode: run.funderLocking,
      }),
  };
};

/**
 * Settle which transaction the identity is named after. An identity is the identifier of a transaction
 * whose output 0 the creating transaction spends. If the funding address holds such a coin, no step is
 * needed; otherwise the run pays itself first.
 */
const settleIdentity = async (run: Run): Promise<void> => {
  const { state } = run;
  if (state.identity !== undefined) return;
  const outputZero = run.stored('funder').find((utxo) => utxo.index === 0);
  if (outputZero !== undefined && state.steps['prepare'] === undefined) {
    state.identity = outputZero.transactionId;
    run.persist();
    run.env.log('  the funding coin is output 0 of its transaction: no self-payment needed');
    return;
  }
  await run.accept('prepare', 'The run pays itself, to have a coin that is output 0 of its transaction', firstTransaction(run).build);
  const prepared = state.steps['prepare'];
  if (prepared === undefined) throw new Error('The self-payment is missing.');
  state.identity = prepared.transactionId;
  run.persist();
};

/**
 * What the run would send first, built and not recorded. A check before starting tries it on a node
 * without sending it.
 */
export const previewFirstTransaction = async (run: Run): Promise<{ name: string; built: BuiltTransaction } | undefined> => {
  if (run.state.steps['create'] !== undefined) return undefined;
  await run.syncFunder();
  const outputZero = run.stored('funder').find((utxo) => utxo.index === 0);
  if (run.state.identity === undefined && outputZero !== undefined && run.state.steps['prepare'] === undefined) {
    // The creation is the first transaction; build it as the run will, without keeping the identity yet.
    run.state.identity = outputZero.transactionId;
    try {
      return { name: 'create', built: firstTransaction(run).build() };
    } finally {
      delete run.state.identity;
    }
  }
  const first = firstTransaction(run);
  if (run.state.steps[first.name] !== undefined) return undefined;
  return { name: first.name, built: first.build() };
};

/** The whole run. Every step is skipped if already done, so this can be run again after an interruption. */
export const runLifecycle = async (run: Run): Promise<void> => {
  const { state } = run;
  const { old, new: fresh } = run.seeds;
  if (state.steps['create'] === undefined) {
    await run.syncFunder();
    if (state.steps['prepare'] === undefined && run.balance('funder') < MINIMUM_FUNDING) {
      throw new Error(`The funding address holds ${run.balance('funder')} satoshis; at least ${MINIMUM_FUNDING} are needed.`);
    }
  }

  run.env.log('Creating the wallet');
  await settleIdentity(run);
  await run.accept('create', 'The controller is created: the wallet\'s identity, with its owner, its recoverer and a waiting period of 512 seconds', firstTransaction(run).build);
  const created = state.steps['create'];
  if (created === undefined) throw new Error('The creation is missing.');
  // The check any client makes before it trusts an identity.
  validateGenesis(decode(created.transactionHex), hexToBin(created.transactionId), run.identity);
  run.env.log(`  identity ${state.identity ?? ''}`);
  await run.waitConfirmed('create');

  const givenOutFirst = run.address('old', ADDRESS_KIND.givenOut, 0);
  const givenOutSecond = run.address('old', ADDRESS_KIND.givenOut, 1);
  const change = (number: number): RunAddress => run.address('old', ADDRESS_KIND.change, number);
  const vault = run.vault('old', 0);

  run.env.log('Receiving and paying');
  await run.accept('receive', 'Someone pays three recoverable addresses (two given out, one change) and a vault address; no script of the wallet runs', () =>
    buildTransaction({
      inputs: run.funderInputs(),
      outputs: [
        { lockingBytecode: givenOutFirst.script.lockingBytecode, valueSatoshis: RECEIVED.givenOutFirst },
        { lockingBytecode: givenOutSecond.script.lockingBytecode, valueSatoshis: RECEIVED.givenOutSecond },
        { lockingBytecode: change(0).script.lockingBytecode, valueSatoshis: RECEIVED.change },
        { lockingBytecode: vault.script.lockingBytecode, valueSatoshis: RECEIVED.vault },
      ],
      changeLockingBytecode: run.funderLocking,
    }),
  );
  await run.accept('pay', 'The owner pays from an address by its key, with change to a change address; the controller is not in the transaction (AD01)', () =>
    buildTransaction({
      inputs: [run.byKey(run.coinAt('old', ADDRESS_KIND.givenOut, 0))],
      outputs: [{ lockingBytecode: run.funderLocking, valueSatoshis: PAYMENT_VALUE }],
      changeLockingBytecode: change(1).script.lockingBytecode,
    }),
  );
  await run.accept('fund-fee', 'The owner gives the recoverer coins for its fees, at the recoverer\'s fee address', () =>
    buildTransaction({
      inputs: run.funderInputs(),
      outputs: [{ lockingBytecode: run.feeLocking, valueSatoshis: FEE_ALLOWANCE }],
      changeLockingBytecode: run.funderLocking,
    }),
  );

  const request: ControllerAction = { kind: 'requestRecovery', proposedOwnerKeyHash: fresh.controllerKey.keyHash };

  run.env.log('A request that the owner cancels');
  await run.refuse('refuse-request-with-sweep', 'The recoverer tries to take a coin of the wallet in the request itself (AD05)', () =>
    run.recovererAction(request, [run.throughController(run.coinAt('old', ADDRESS_KIND.change, 0))]),
    // The controller (input 0) and the recoverer's fee coin (input 1) pass; the attached coin's script refuses.
    refusedByScript(2),
  );
  await run.accept('request-1', 'The recoverer requests recovery to a new key, paying its own fee', () => run.recovererAction(request));
  await run.refuse('refuse-early-completion', 'The recoverer tries to complete before the waiting period has passed (CT02)', () =>
    run.recovererAction({ kind: 'finalizeRecovery' }),
    REFUSED_BY_TIME,
  );
  await run.accept('cancel', 'The owner cancels the request; a coin of the wallet, spent by its key, pays the fee (CT04)', () => {
    const { utxo, state: controllerState } = run.controller();
    const action: ControllerAction = { kind: 'ownerAuthorize' };
    return buildTransaction({
      inputs: [controllerInput(utxo, controllerState, action, old.controllerKey), run.byKey(run.coinAt('old', ADDRESS_KIND.givenOut, 1))],
      outputs: [controllerSuccessor(utxo, controllerState, action)],
      changeLockingBytecode: change(2).script.lockingBytecode,
    });
  });

  run.env.log('A request that nobody cancels');
  await run.accept('request-2', 'The recoverer requests recovery again', () => run.recovererAction(request));
  await run.accept('complete', 'After the waiting period the recoverer completes; the new key is the owner and no coin has moved (CT07)', () => run.recovererAction({ kind: 'finalizeRecovery' }), {
    waitUntilFinal: true,
  });

  run.env.log('The new owner takes over');
  const sweepTo = run.address('new', ADDRESS_KIND.change, 0).script.lockingBytecode;
  const vaultTo = run.address('new', ADDRESS_KIND.change, 1).script.lockingBytecode;
  await run.refuse('refuse-sweep-by-earlier-owner', 'The earlier owner\'s controller key tries to approve a sweep after the recovery (AD07)', () =>
    run.ownerApproved(old.controllerKey, run.coins('old', 'recoverable').map((coin) => run.throughController(coin)), sweepTo),
    // The controller itself refuses the earlier key.
    refusedByScript(0),
  );
  await run.accept('sweep', 'The new owner sweeps every coin at the earlier seed\'s addresses to an address of its own seed (AD03)', () =>
    run.ownerApproved(fresh.controllerKey, run.coins('old', 'recoverable').map((coin) => run.throughController(coin)), sweepTo),
  );
  await run.accept('vault-spend', 'The new owner spends the coin at the vault address, which never obeyed a key (AD09)', () =>
    run.ownerApproved(fresh.controllerKey, run.coins('old', 'vault').map((coin) => run.throughController(coin)), vaultTo),
  );

  run.env.log('Sending everything and closing');
  await run.accept('close', 'The new owner sends everything and closes the wallet: its coins and the controller\'s value go back in one transaction (CT13)', () =>
    run.closing(fresh.controllerKey, run.coins('new', 'recoverable').map((coin) => run.byKey(coin)), run.funderLocking),
  );
  await run.accept('return-fee', 'The recoverer returns what is left of its fee coins', () =>
    buildTransaction({ inputs: run.feeInputs(), outputs: [{ lockingBytecode: run.funderLocking, valueSatoshis: 0n }], remainderOutputIndex: 0 }),
  );
};

/** What the chain holds at the scripts of the run, read from the servers and not from the run's own records. */
export interface EndState {
  /** Satoshis at the funding address. */
  returnedSatoshis: bigint;
  /** Every other script of the run that still holds something. Empty after a complete run. */
  leftBehind: { name: string; outputs: number; valueSatoshis: bigint }[];
  /** Whether the controller's history ends with a closing. */
  closed: boolean;
}

/** Read from the chain what the run left where. */
export const readEndState = async (run: Run): Promise<EndState> => {
  let returnedSatoshis = 0n;
  const leftBehind: EndState['leftBehind'] = [];
  for (const { name, lockingBytecode } of run.everyScript()) {
    const unspent = await run.chain.listUnspent(lockingBytecode);
    const valueSatoshis = unspent.reduce((sum, entry) => sum + entry.valueSatoshis, 0n);
    if (sameBytes(lockingBytecode, run.funderLocking)) returnedSatoshis = valueSatoshis;
    else if (unspent.length > 0) leftBehind.push({ name, outputs: unspent.length, valueSatoshis });
  }
  let closed = false;
  const created = run.state.steps['create'];
  if (run.state.identity !== undefined && created?.status === 'done') {
    closed = (await readControllerHistory(run.chain, run.identity, created.transactionId)).closed !== undefined;
  }
  return { returnedSatoshis, leftBehind, closed };
};

/**
 * Return everything that can be returned to the funding address, from wherever a run stopped. Coins at
 * recoverable addresses go by their keys; coins at vault addresses go through the controller; then the
 * wallet is closed, and the recoverer's fee coins follow.
 */
export const returnAll = async (run: Run): Promise<void> => {
  const { state } = run;
  await run.settlePending();
  await run.syncFunder();
  const recoverable = (): StoredUtxo[] => SEEDS.flatMap((seed) => run.coins(seed, 'recoverable'));
  const vaults = (): StoredUtxo[] => SEEDS.flatMap((seed) => run.coins(seed, 'vault'));
  if (run.stored('controller').length > 0) {
    const owner = run.seeds[run.currentOwner()].controllerKey;
    if (vaults().length > 0) {
      await run.accept(numbered(state, 'return-vault'), 'Coins at vault addresses returned, through the controller', () =>
        run.ownerApproved(owner, vaults().map((coin) => run.throughController(coin)), run.funderLocking),
      );
    }
    // Closing needs another coin beside the controller: the wallet's own, or one of the funding address.
    const beside = recoverable().length > 0 ? recoverable().map((coin) => run.byKey(coin)) : run.funderInputs();
    if (beside.length === 0) {
      run.env.log('The controller is left open: there is no coin to close it with.');
    } else {
      await run.accept(numbered(state, 'return-close'), 'The wallet closed and its coins returned', () => run.closing(owner, beside, run.funderLocking));
    }
  } else {
    if (vaults().length > 0) run.env.log('Coins at vault addresses cannot be returned: the wallet is closed.');
    if (recoverable().length > 0) {
      await run.accept(numbered(state, 'return-coins'), 'Coins at recoverable addresses returned, by their keys', () =>
        buildTransaction({ inputs: recoverable().map((coin) => run.byKey(coin)), outputs: [{ lockingBytecode: run.funderLocking, valueSatoshis: 0n }], remainderOutputIndex: 0 }),
      );
    }
  }
  if (run.stored('fee').length > 0) {
    await run.accept(numbered(state, 'return-fee'), 'The recoverer\'s fee coins returned', () =>
      buildTransaction({ inputs: run.feeInputs(), outputs: [{ lockingBytecode: run.funderLocking, valueSatoshis: 0n }], remainderOutputIndex: 0 }),
    );
  }
};
