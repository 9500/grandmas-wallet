// Runs the wallet's whole lifecycle through the XO engine on chipnet, using the frozen Grandma's Wallet
// template: three accounts (owner, recoverer, replacement device), each in its own long-lived process.
//
// usage (from the repository root):
//   npm run xo-demo -- addresses     show where each account receives ordinary coins
//   npm run xo-demo -- run           the lifecycle
//   npm run xo-demo -- run-short     the lifecycle without the cancelled request and the payments
//   npm run xo-demo -- rescue        return a wallet's funds after a run that stopped part-way
//   npm run xo-demo -- pay <from> <account or address> <satoshis>   move ordinary coins
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  type Output,
  type TransactionCommon,
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransactionBch,
  generateBip39Mnemonic,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { Electrum } from '@grandmas-wallet/chipnet/electrum';
import {
  type ControllerSnapshot,
  type ControllerState,
  type Utxo,
  afterFinalizeRecovery,
  afterOwnerUpdate,
  assetScript,
  buildTransaction,
  controllerInput,
  controllerSuccessor,
  decodeControllerState,
  deriveXoTemplateKey,
  encodeChallengeDelay,
  encodeControllerState,
  followController,
  protectedInput,
  savingsJarScript,
  validateGenesis,
  verifyTransaction,
} from '@grandmas-wallet/core';
import { grandmasWalletTemplateIdentifier } from '@grandmas-wallet/templates';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const DATA = resolve(ROOT, '.xo-demo');
const INVITATIONS = resolve(ROOT, 'docs/bounty/invitations');
const LOG = resolve(ROOT, 'docs/bounty/lifecycle-log.md');
/** Where the wallet's outputs currently are, kept so that funds can be returned if a run stops part-way. */
const ON_CHAIN = resolve(DATA, 'on-chain.json');
const ENDPOINT = process.env['CHIPNET_ENDPOINT'] ?? 'wss://chipnet.9500.cash:443';

const CONTROLLER_SATOSHIS = 1_000n;
// Fees are set per kind of transaction from their measured sizes, at a little over one satoshi per byte.
/** Owner actions that spend the controller and wallet funds: about 1,100 bytes. */
const FEE = 1_120n;
/** Recoverer actions and changes of settings, which spend the controller and one ordinary coin: under 1,020 bytes. */
const CONTROLLER_ONLY_FEE = 1_030n;
/** Creating the wallet: about 350 bytes. */
const CREATE_FEE = 360n;
/** An ordinary one-input payment: under 200 bytes. */
const COIN_FEE = 200n;
/** Each ordinary coin spent beyond the first adds about 141 bytes. */
const EXTRA_COIN_FEE = 150n;
/** Changing the settings passes three more values to the controller than other actions: about 70 bytes. */
const UPDATE_EXTRA_FEE = 80n;

/** Fee for a transaction that spends the controller and the given ordinary coins. */
const controllerFee = (coins: unknown[], extra = 0n): bigint =>
  CONTROLLER_ONLY_FEE + EXTRA_COIN_FEE * BigInt(Math.max(coins.length - 1, 0)) + extra;
const PAYMENT = 600n;
const JAR_AMOUNT = 1_700n;
/** One 512-second interval, time-based, as a mainnet wallet would use. */
const CHALLENGE_DELAY = { unit: 'time512', value: 1 } as const;
const JAR_LOCK_SECONDS = 420;
const RETRY_MS = 30_000;
const RETRY_LIMIT_MS = 60 * 60_000;

const say = (message: string): void => console.log(message);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const hex = (bytes: Uint8Array): string => binToHex(bytes);
const sats = (amount: bigint): string => `${amount}n`;
const delayHex = (delay: ControllerState['challengeDelay']): string => {
  const sequence = encodeChallengeDelay(delay);
  return hex(Uint8Array.of(sequence & 0xff, (sequence >> 8) & 0xff, (sequence >> 16) & 0xff));
};
const addressOf = (lockingBytecode: string): string => {
  const result = lockingBytecodeToCashAddress({ prefix: 'bchtest', bytecode: hexToBin(lockingBytecode) });
  return typeof result === 'string' ? result : result.address;
};
const decode = (transactionHex: string): TransactionCommon => {
  const transaction = decodeTransactionBch(hexToBin(transactionHex));
  if (typeof transaction === 'string') throw new Error(transaction);
  return transaction;
};

interface Coin { transactionId: string; index: number; satoshis: string }
interface Built {
  invitationIdentifier: string;
  ownInputIndexes: number[];
  missing: unknown;
  transactionId: string;
  transactionHex: string;
  invitation: string;
}

/** One account's engine, running in its own process. */
class Agent {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  readonly ready: Promise<void>;
  coinLockingBytecode = '';

  constructor(readonly name: string) {
    this.child = spawn('npx', ['tsx', resolve(HERE, 'agent.ts'), name], { cwd: resolve(HERE, '..'), stdio: ['pipe', 'pipe', 'inherit'] });
    let ready: () => void = () => undefined;
    this.ready = new Promise((done) => { ready = done; });
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
      if (!line.startsWith('{')) return;
      const { id, result, error } = JSON.parse(line) as { id: number; result?: unknown; error?: string };
      if (id === 0) { ready(); return; }
      const pending = this.waiting.get(id);
      this.waiting.delete(id);
      if (error !== undefined) pending?.reject(new Error(`${this.name}: ${error}`));
      else pending?.resolve(result);
    });
  }

  request<T>(operation: string, parameters: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((done, fail) => {
      this.waiting.set(id, { resolve: done as (value: unknown) => void, reject: fail });
      this.child.stdin?.write(`${JSON.stringify({ id, operation, ...parameters })}\n`);
    });
  }

  async start(): Promise<this> {
    await this.ready;
    const { coinLockingBytecode } = await this.request<{ coinLockingBytecode: string }>('describe');
    this.coinLockingBytecode = coinLockingBytecode;
    return this;
  }

  async coins(): Promise<Coin[]> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const coins = await this.request<Coin[]>('coins');
      if (coins.length > 0) return coins;
      await sleep(1_500);
    }
    return [];
  }

  /** Wait until this account's engine has registered the given outputs, which lags a broadcast slightly. */
  async sees(outpoints: { transactionId: string; index: number }[]): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const unspent = await this.request<{ transactionId: string; index: number }[]>('unspent');
      const known = new Set(unspent.map(({ transactionId, index }) => `${transactionId}:${index}`));
      if (outpoints.every(({ transactionId, index }) => known.has(`${transactionId}:${index}`))) return;
      await sleep(1_500);
    }
    throw new Error(`${this.name}: the engine did not register ${outpoints.map((o) => `${o.transactionId}:${o.index}`).join(', ')}`);
  }

  stop(): void {
    this.child.stdin?.write(`${JSON.stringify({ id: this.nextId++, operation: 'stop' })}\n`);
  }
}

const total = (coins: Coin[]): bigint => coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
const asInputs = (coins: Coin[]) => coins.map(({ transactionId, index }) => ({ transactionId, index }));

/** The run: accounts, what the wallet currently looks like on chain, and a record of what was done. */
class Lifecycle {
  readonly known = new Map<string, Output>();
  readonly record: { step: string; shows: string; account: string; transactionId: string; file: string }[] = [];
  controller!: ControllerSnapshot;
  wallet!: Utxo;
  jar?: { utxo: Utxo; unlockTime: number };
  identity = '';

  constructor(
    readonly electrum: Electrum,
    readonly owner: Agent,
    readonly recoverer: Agent,
    readonly replacement: Agent,
  ) {}

  private remember(transactionHex: string, transactionId: string): TransactionCommon {
    const transaction = decode(transactionHex);
    transaction.outputs.forEach((output, index) => this.known.set(`${transactionId}:${index}`, output));
    return transaction;
  }

  private async spent(transaction: TransactionCommon): Promise<Output[]> {
    const outputs: Output[] = [];
    for (const input of transaction.inputs) {
      const id = hex(input.outpointTransactionHash);
      if (!this.known.has(`${id}:${input.outpointIndex}`)) {
        const source = await this.electrum.getTransaction(id);
        if (source === undefined) throw new Error(`cannot find transaction ${id}`);
        this.remember(source, id);
      }
      outputs.push(this.known.get(`${id}:${input.outpointIndex}`) as Output);
    }
    return outputs;
  }

  /**
   * Check a transaction the engine built against the network's script rules, send it, and keep the
   * invitation. A transaction that is not yet valid on chain is retried until it is.
   */
  async send(agent: Agent, built: Built, step: string, shows: string, options: { waitUntilFinal?: boolean } = {}): Promise<TransactionCommon> {
    const transaction = decode(built.transactionHex);
    const check = verifyTransaction({ transaction, sourceOutputs: await this.spent(transaction) });
    if (check !== true) throw new Error(`${step}: the engine built a transaction that fails the local check: ${check}`);
    // The network relays at one satoshi per byte; a lower fee would be refused only after the invitation is final.
    const sources = await this.spent(transaction);
    const fee = sources.reduce((sum, output) => sum + output.valueSatoshis, 0n) - transaction.outputs.reduce((sum, output) => sum + output.valueSatoshis, 0n);
    const size = BigInt(built.transactionHex.length / 2);
    if (fee < size) throw new Error(`${step}: fee of ${fee} sat is below one satoshi per byte for ${size} bytes`);

    const deadline = Date.now() + RETRY_LIMIT_MS;
    let waiting = false;
    let invitation: string;
    for (;;) {
      try {
        ({ invitation } = await agent.request<{ invitation: string }>('broadcast', { invitationIdentifier: built.invitationIdentifier }));
        break;
      } catch (error) {
        const reason = (error as Error).message;
        if (options.waitUntilFinal !== true || !/non-?final|bip68/i.test(reason) || Date.now() > deadline) throw error;
        if (!waiting) say(`  wait   ${step}: not yet valid on chain; retrying every 30 s`);
        waiting = true;
        await sleep(RETRY_MS);
      }
    }
    this.remember(built.transactionHex, built.transactionId);
    const file = `${String(this.record.length + 1).padStart(2, '0')}-${step}.json`;
    writeFileSync(resolve(INVITATIONS, file), `${invitation}\n`);
    this.record.push({ step, shows, account: agent.name, transactionId: built.transactionId, file });
    say(`  done   ${step}  ${built.transactionId}`);
    return transaction;
  }

  /** Save where the wallet's outputs are. Called after every step that moves them. */
  private persist(): void {
    const outpoint = (utxo: Utxo) => ({ transactionId: hex(utxo.transactionHash), index: utxo.index });
    writeFileSync(
      ON_CHAIN,
      JSON.stringify({
        identity: this.identity,
        controller: outpoint(this.controller.utxo),
        wallet: outpoint(this.wallet),
        ...(this.jar === undefined ? {} : { jar: { ...outpoint(this.jar.utxo), unlockTime: this.jar.unlockTime } }),
      }, null, 1),
    );
  }

  private utxo(transaction: TransactionCommon, transactionId: string, index: number): Utxo {
    return { transactionHash: hexToBin(transactionId), index, output: transaction.outputs[index] as Output };
  }

  private advance(transaction: TransactionCommon, transactionId: string, expected: string): void {
    const next = followController(this.controller, transaction, hexToBin(transactionId));
    if (next.kind !== expected) throw new Error(`expected the controller to record ${expected}, saw ${next.kind}`);
    this.controller = next;
    if (this.wallet !== undefined) this.persist();
  }

  private get stateHex(): string {
    return hex(encodeControllerState(this.controller.state));
  }

  private controllerInput(inputIdentifier: string) {
    return { transactionId: hex(this.controller.utxo.transactionHash), index: this.controller.utxo.index, inputIdentifier };
  }

  private walletInput() {
    return { transactionId: hex(this.wallet.transactionHash), index: this.wallet.index, inputIdentifier: 'walletInput' };
  }

  async createWallet(recovererKeyHash: string): Promise<void> {
    let coins = await this.owner.coins();
    if (!coins.some((coin) => coin.index === 0)) {
      // The identity is the hash of a transaction whose first output funds the wallet; make such an output.
      const built = await this.owner.request<Built>('pay', { lockingBytecode: this.owner.coinLockingBytecode, satoshis: sats(total(coins) - COIN_FEE) });
      await this.owner.request('broadcast', { invitationIdentifier: built.invitationIdentifier });
      await this.owner.sees([{ transactionId: built.transactionId, index: 0 }]);
      coins = await this.owner.coins();
    }
    const funding = coins.find((coin) => coin.index === 0);
    if (funding === undefined) throw new Error('the owner needs a coin that is the first output of its transaction');
    this.identity = funding.transactionId;
    const received = BigInt(funding.satoshis) - CONTROLLER_SATOSHIS - CREATE_FEE;
    const built = await this.owner.request<Built>('start', {
      action: 'createWallet',
      role: 'owner',
      variables: {
        identity: this.identity,
        recovererKeyHash,
        challengeDelay: delayHex(CHALLENGE_DELAY),
        controllerSatoshis: sats(CONTROLLER_SATOSHIS),
        receivedSatoshis: sats(received),
      },
      derive: { ownerKeyHash: 'ownerKey' },
      inputs: asInputs([funding]),
      outputs: ['newControllerOutput', 'receivedFundsOutput'],
    });
    const transaction = await this.send(this.owner, built, 'create-wallet', 'Owner sets up the wallet alone; the recoverer is enrolled by its key hash only');
    this.controller = validateGenesis(transaction, hexToBin(built.transactionId), hexToBin(this.identity));
    this.wallet = this.utxo(transaction, built.transactionId, 1);
    if (hex(this.wallet.output.lockingBytecode) !== hex(assetScript(hexToBin(this.identity)).lockingBytecode)) {
      throw new Error('the wallet address the engine produced differs from the one this library derives');
    }
    this.persist();
  }

  /** An action by the wallet's owner that spends the controller and the wallet's funds. */
  private async ownerAction(
    agent: Agent,
    step: string,
    shows: string,
    action: string,
    variables: Record<string, string | number>,
    middleOutputs: string[],
    spending: bigint,
  ): Promise<{ transaction: TransactionCommon; transactionId: string }> {
    const change = this.wallet.output.valueSatoshis - spending - FEE;
    await agent.sees([this.controllerInput(''), this.walletInput()]);
    const built = await agent.request<Built>('start', {
      action,
      role: 'owner',
      variables: {
        identity: this.identity,
        controllerState: this.stateHex,
        controllerSatoshis: sats(CONTROLLER_SATOSHIS),
        changeSatoshis: sats(change),
        ...variables,
      },
      inputs: [this.controllerInput('ownerControllerInput'), this.walletInput()],
      outputs: ['activeControllerOutput', ...middleOutputs, 'changeOutput'],
    });
    const transaction = await this.send(agent, built, step, shows);
    this.advance(transaction, built.transactionId, 'ownerAuthorize');
    this.wallet = this.utxo(transaction, built.transactionId, 1 + middleOutputs.length);
    this.persist();
    return { transaction, transactionId: built.transactionId };
  }

  async pay(agent: Agent, step: string, shows: string): Promise<void> {
    await this.ownerAction(agent, step, shows, 'send', { sentSatoshis: sats(PAYMENT), recipientLockingScript: agent.coinLockingBytecode }, ['paymentOutput'], PAYMENT);
  }

  /** Opening a jar is an ordinary payment from the wallet to the jar's address. */
  async openJar(): Promise<void> {
    const unlockTime = Math.floor(Date.now() / 1000) + JAR_LOCK_SECONDS;
    const jar = savingsJarScript(hexToBin(this.identity), unlockTime);
    const { transaction, transactionId } = await this.ownerAction(
      this.owner, 'open-savings-jar', 'Owner pays into a savings jar, an application with its own template', 'send',
      { sentSatoshis: sats(JAR_AMOUNT), recipientLockingScript: hex(jar.lockingBytecode) }, ['paymentOutput'], JAR_AMOUNT,
    );
    this.jar = { utxo: this.utxo(transaction, transactionId, 1), unlockTime };
    this.persist();
    // The owner's engine learns the jar's address from the Savings Jar template.
    const tracked = await this.owner.request<string>('track', { what: 'jar', variables: { identity: this.identity, unlockTime } });
    if (tracked !== hex(jar.lockingBytecode)) throw new Error('the savings jar address from its template differs from the one this library derives');
  }

  async cancel(): Promise<void> {
    await this.ownerAction(this.owner, 'cancel-recovery', 'Owner cancels the recovery request', 'cancelRecovery', {}, [], 0n);
  }

  /**
   * A recovery request, made together by the recoverer and the replacement device: the recoverer starts it,
   * the device joins to create and name the new owner key, and the recoverer signs and sends.
   * Returns the device's copy of the invitation, under which it holds its new key.
   */
  async requestRecovery(step: string, firstTime: boolean): Promise<string> {
    const coins = await this.recoverer.coins();
    if (!firstTime) await this.recoverer.sees([this.controllerInput('')]);
    const started = await this.recoverer.request<{ invitation: string }>('start', {
      action: 'requestRecovery',
      role: 'recoverer',
      // The recoverer's key exists only as a hash in the wallet until its first request, when it is derived.
      ...(firstTime ? { generate: ['recovererKey'] } : {}),
      variables: { identity: this.identity, controllerState: this.stateHex, controllerSatoshis: sats(CONTROLLER_SATOSHIS) },
      inputs: [this.controllerInput('claimControllerInput'), ...asInputs(coins)],
    });
    const joined = await this.replacement.request<{ invitation: string; invitationIdentifier: string; derived: Record<string, string> }>('join', {
      invitation: started.invitation,
      role: 'owner',
      derive: { proposedOwnerKeyHash: 'ownerKey' },
    });
    const built = await this.recoverer.request<Built>('continue', {
      invitation: joined.invitation,
      outputs: ['pendingControllerOutput'],
      rawOutputs: [{ lockingBytecode: this.recoverer.coinLockingBytecode, satoshis: String(total(coins) - controllerFee(coins)) }],
      build: true,
    });
    const transaction = await this.send(this.recoverer, built, step, 'Recoverer and replacement device request recovery together; the recoverer pays the fee');
    this.advance(transaction, built.transactionId, 'requestRecovery');
    if (hex(this.controller.state.proposedOwnerKeyHash ?? new Uint8Array()) !== joined.derived['proposedOwnerKeyHash']) {
      throw new Error('the request names a different new owner than the replacement device provided');
    }
    // The device takes in the finished invitation, which is how it learns of the controller output.
    const stored = await this.recoverer.request<{ invitation: string }>('continue', { invitation: built.invitation });
    await this.replacement.request('continue', { invitation: stored.invitation });
    return joined.invitationIdentifier;
  }

  async finalize(): Promise<void> {
    const coins = await this.recoverer.coins();
    const next = afterFinalizeRecovery(this.controller.state);
    await this.recoverer.sees([this.controllerInput('')]);
    const built = await this.recoverer.request<Built>('start', {
      action: 'finalizeRecovery',
      role: 'recoverer',
      variables: {
        identity: this.identity,
        nextControllerState: hex(encodeControllerState(next)),
        challengeSequence: encodeChallengeDelay(this.controller.state.challengeDelay),
        controllerSatoshis: sats(CONTROLLER_SATOSHIS),
      },
      inputs: [this.controllerInput('finalizeControllerInput'), ...asInputs(coins)],
      outputs: ['nextControllerOutput'],
      rawOutputs: [{ lockingBytecode: this.recoverer.coinLockingBytecode, satoshis: String(total(coins) - controllerFee(coins)) }],
    });
    const transaction = await this.send(this.recoverer, built, 'complete-recovery', 'Recoverer completes recovery once the challenge delay has passed', { waitUntilFinal: true });
    this.advance(transaction, built.transactionId, 'finalizeRecovery');
  }

  /** The replacement device starts following the wallet's and the jar's addresses. Neither needs a key. */
  async adopt(): Promise<void> {
    const wallet = await this.replacement.request<string>('track', { what: 'wallet', variables: { identity: this.identity } });
    if (wallet !== hex(this.wallet.output.lockingBytecode)) throw new Error('the replacement device derived a different wallet address');
    if (this.jar !== undefined) {
      const jar = await this.replacement.request<string>('track', { what: 'jar', variables: { identity: this.identity, unlockTime: this.jar.unlockTime } });
      if (jar !== hex(this.jar.utxo.output.lockingBytecode)) throw new Error('the replacement device derived a different savings jar address');
    }
  }

  /**
   * The new owner empties the jar: the wallet's approve action, with the jar as an extra input from the
   * Savings Jar template and its funds going to the wallet's address.
   */
  async withdrawJar(): Promise<void> {
    if (this.jar === undefined) return;
    const { utxo, unlockTime } = this.jar;
    const jarInput = { transactionId: hex(utxo.transactionHash), index: utxo.index };
    await this.replacement.sees([this.controllerInput(''), jarInput]);
    const built = await this.replacement.request<Built>('start', {
      action: 'approve',
      role: 'owner',
      variables: { identity: this.identity, controllerState: this.stateHex, controllerSatoshis: sats(CONTROLLER_SATOSHIS) },
      inputs: [this.controllerInput('ownerControllerInput'), jarInput],
      outputs: ['activeControllerOutput'],
      rawOutputs: [{ lockingBytecode: hex(this.wallet.output.lockingBytecode), satoshis: String(utxo.output.valueSatoshis - FEE) }],
      locktime: unlockTime,
    });
    const transaction = await this.send(this.replacement, built, 'empty-savings-jar', 'New owner approves emptying the savings jar after its unlock time; the jar never moved', { waitUntilFinal: true });
    this.advance(transaction, built.transactionId, 'ownerAuthorize');
    delete this.jar;
    this.persist();
  }

  /** The new owner doubles the challenge delay, paying the fee from coins outside the wallet. */
  async updateRecovery(): Promise<void> {
    const coins = await this.replacement.coins();
    if (total(coins) < controllerFee(coins, UPDATE_EXTRA_FEE) + 546n) {
      say('  skip   change-recovery-settings: the replacement device has no coins outside the wallet for the fee');
      return;
    }
    const challengeDelay = { unit: 'time512', value: 2 } as const;
    const next = afterOwnerUpdate(this.controller.state, { challengeDelay });
    await this.replacement.sees([this.controllerInput('')]);
    const built = await this.replacement.request<Built>('start', {
      action: 'updateRecovery',
      role: 'owner',
      variables: {
        identity: this.identity,
        nextControllerState: hex(encodeControllerState(next)),
        newOwnerKeyHash: hex(next.ownerKeyHash),
        newRecovererKeyHash: hex(next.recovererKeyHash),
        newChallengeDelay: delayHex(challengeDelay),
        controllerSatoshis: sats(CONTROLLER_SATOSHIS),
      },
      inputs: [this.controllerInput('updateControllerInput'), ...asInputs(coins)],
      outputs: ['nextControllerOutput'],
      rawOutputs: [{ lockingBytecode: this.replacement.coinLockingBytecode, satoshis: String(total(coins) - controllerFee(coins, UPDATE_EXTRA_FEE)) }],
    });
    const transaction = await this.send(this.replacement, built, 'change-recovery-settings', 'New owner changes the challenge delay, paying the fee from outside the wallet');
    this.advance(transaction, built.transactionId, 'ownerUpdate');
  }

  writeLog(): void {
    const rows = this.record.map(
      ({ step, shows, account, transactionId, file }, index) =>
        `| ${index + 1} | ${step} | ${account} | ${shows} | \`${transactionId}\` | [${file}](invitations/${file}) |`,
    );
    writeFileSync(
      LOG,
      [
        '# Lifecycle through the XO engine',
        '',
        'Written by `npm run xo-demo -- run`. Every transaction was built and signed by the XO engine from an invitation, checked against the network\'s script rules by this project\'s own code, and then broadcast by the engine on chipnet.',
        '',
        `- Template: Grandma's Wallet version 1, identifier \`${grandmasWalletTemplateIdentifier}\``,
        `- Wallet identity: \`${this.identity}\``,
        `- Wallet address: \`${this.identity === '' ? '' : addressOf(hex(assetScript(hexToBin(this.identity)).lockingBytecode))}\``,
        '',
        '| # | Step | Account | What it shows | Transaction | Invitation |',
        '| --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n'),
    );
  }
}

/**
 * Return a wallet's funds to its owner's ordinary address using this project's own transaction builder and
 * the key the XO engine would derive. For a run that stopped part-way, whose engine state is gone.
 */
const rescue = async (agents: Agent[]): Promise<void> => {
  if (!existsSync(ON_CHAIN)) throw new Error('nothing recorded to rescue');
  const record = JSON.parse(readFileSync(ON_CHAIN, 'utf8')) as {
    identity: string;
    controller: { transactionId: string; index: number };
    wallet: { transactionId: string; index: number };
    jar?: { transactionId: string; index: number; unlockTime: number };
  };
  const electrum = await Electrum.connect(ENDPOINT);
  try {
    const fetch = async ({ transactionId, index }: { transactionId: string; index: number }): Promise<Utxo> => {
      const source = await electrum.getTransaction(transactionId);
      if (source === undefined) throw new Error(`cannot find ${transactionId}`);
      return { transactionHash: hexToBin(transactionId), index, output: decode(source).outputs[index] as Output };
    };
    const controller = await fetch(record.controller);
    const commitment = controller.output.token?.nft?.commitment;
    if (commitment === undefined) throw new Error('the recorded controller output carries no state');
    const state = decodeControllerState(commitment);

    // Find which account's key owns the wallet now.
    const candidates = agents.flatMap((agent) => {
      const path = resolve(DATA, `${agent.name}.mnemonic`);
      if (!existsSync(path)) return [];
      const mnemonic = readFileSync(path, 'utf8').trim();
      return [0, 1, 2, 3].map((index) => ({ agent, key: deriveXoTemplateKey(mnemonic, grandmasWalletTemplateIdentifier, index, 'testnet') }));
    });
    const holder = candidates.find(({ key }) => hex(key.keyHash) === hex(state.ownerKeyHash));
    if (holder === undefined) throw new Error('no local account holds the wallet\'s owner key');

    const identity = hexToBin(record.identity);
    const jarUnlocked = record.jar !== undefined && Date.now() / 1000 > record.jar.unlockTime + 1_200;
    const action = { kind: 'ownerAuthorize' } as const;
    const built = buildTransaction({
      inputs: [
        controllerInput(controller, state, action, holder.key),
        protectedInput(await fetch(record.wallet), assetScript(identity)),
        ...(record.jar !== undefined && jarUnlocked ? [protectedInput(await fetch(record.jar), savingsJarScript(identity, record.jar.unlockTime))] : []),
      ],
      outputs: [controllerSuccessor(controller, state, action)],
      changeLockingBytecode: hexToBin(holder.agent.coinLockingBytecode),
      ...(record.jar !== undefined && jarUnlocked ? { locktime: record.jar.unlockTime } : {}),
    });
    const check = verifyTransaction(built);
    if (check !== true) throw new Error(`rescue transaction fails the local check: ${check}`);
    const result = await electrum.broadcast(hex(built.encoded));
    if (!result.accepted) throw new Error(`rescue refused by the network: ${result.reason}`);
    say(`Returned ${built.transaction.outputs[1]?.valueSatoshis} sat to ${holder.agent.name} (${built.transactionId}).`);
    if (record.jar !== undefined && !jarUnlocked) say('A savings jar is still locked; run rescue again later to return it.');
    else writeFileSync(ON_CHAIN, JSON.stringify({ ...record, rescued: built.transactionId }, null, 1));
  } finally {
    await electrum.disconnect();
  }
};

const main = async (): Promise<void> => {
  const [command = 'addresses'] = process.argv.slice(2);
  mkdirSync(DATA, { recursive: true });
  mkdirSync(INVITATIONS, { recursive: true });

  // One-way enrollment: the owner's side creates the recovery mnemonic and works out the recoverer's key
  // hash from it. The recoverer only ever receives the mnemonic.
  const recoveryMnemonicPath = resolve(DATA, 'recoverer.mnemonic');
  if (!existsSync(recoveryMnemonicPath)) writeFileSync(recoveryMnemonicPath, generateBip39Mnemonic(), { mode: 0o600 });
  const recovererKey = deriveXoTemplateKey(readFileSync(recoveryMnemonicPath, 'utf8').trim(), grandmasWalletTemplateIdentifier, 0, 'testnet');

  const agents = await Promise.all(['owner', 'recoverer', 'replacement'].map((name) => new Agent(name).start()));
  const [owner, recoverer, replacement] = agents as [Agent, Agent, Agent];
  try {
    for (const agent of agents) {
      say(`${agent.name.padEnd(12)} ${addressOf(agent.coinLockingBytecode)}  ${total(await agent.coins())} sat`);
    }
    if (command === 'pay') {
      // Move ordinary coins from one account to another account or address, for setting up a run.
      const [, from, to, amount] = process.argv.slice(2);
      const payer = agents.find((agent) => agent.name === from);
      const recipient = agents.find((agent) => agent.name === to);
      const decoded = recipient === undefined ? cashAddressToLockingBytecode(to ?? '') : undefined;
      if (payer === undefined || amount === undefined || typeof decoded === 'string') {
        throw new Error('usage: pay <owner|recoverer|replacement> <account or chipnet address> <satoshis>');
      }
      const lockingBytecode = recipient?.coinLockingBytecode ?? hex((decoded as { bytecode: Uint8Array }).bytecode);
      const built = await payer.request<Built>('pay', { lockingBytecode, satoshis: sats(BigInt(amount)) });
      await payer.request('broadcast', { invitationIdentifier: built.invitationIdentifier });
      say(`Paid ${amount} sat from ${from} to ${to} (${built.transactionId}).`);
      return;
    }
    if (command === 'rescue') {
      await rescue(agents);
      return;
    }
    if (command !== 'run' && command !== 'run-short') return;

    const electrum = await Electrum.connect(ENDPOINT);
    const run = new Lifecycle(electrum, owner, recoverer, replacement);
    try {
      say('Setting up');
      await run.createWallet(hex(recovererKey.keyHash));
      say(`  identity ${run.identity}`);

      // The short run leaves out the cancelled request and the payments, for when test coins are scarce.
      const full = command === 'run';
      if (full) {
        await run.pay(owner, 'send', 'Owner pays from the wallet without the recoverer');
        say('Recovery request, cancelled by the owner');
        await run.requestRecovery('request-recovery-1', true);
        await run.cancel();
      }
      await run.openJar();

      say('Recovery after an unchallenged delay');
      await run.requestRecovery(full ? 'request-recovery-2' : 'request-recovery', !full);
      await run.finalize();

      say('The replacement device takes over');
      await run.adopt();
      if (full) await run.pay(replacement, 'send-after-recovery', 'New owner pays from the same wallet funds, which never moved');
      await run.withdrawJar();
      await run.updateRecovery();
      say('Lifecycle complete.');
    } finally {
      run.writeLog();
      for (const agent of agents) {
        const messages = await agent.request<string[]>('messages').catch(() => []);
        const distinct = [...new Set(messages.map((message) => message.replace(/\d+/g, 'N')))];
        if (distinct.length > 0) say(`  ${agent.name}: the engine logged ${messages.length} message(s), e.g. ${distinct[0]?.slice(0, 110)}`);
      }
      await electrum.disconnect();
    }
  } finally {
    agents.forEach((agent) => agent.stop());
  }
};

main().then(
  () => setTimeout(() => process.exit(0), 300),
  (error: unknown) => {
    console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
    setTimeout(() => process.exit(1), 300);
  },
);
