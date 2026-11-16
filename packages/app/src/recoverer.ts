import { hexToBin } from '@bitauth/libauth';
import { type ArchiveStore, type RestoreReport, type SignedMessage, restore } from '@grandmas-wallet/archive';
import {
  type ControllerHistory,
  afterFinalizeRecovery,
  encodeChallengeDelay,
  encodeControllerState,
  followController,
  readControllerHistory,
} from '@grandmas-wallet/core';
import { type EnrollmentPackage, type VerifiedEnrollment, acknowledgeEnrollment, parsePackage, verifyEnrollment } from '@grandmas-wallet/enrollment';

import type { XoAccount } from './account.js';
import { type Eligibility, recoveryEligibility } from './eligibility.js';
import { type AppChain, type Sent, checkAndSend, controllerFee, hex, outpointOf, sats, waitUntilSeen } from './support.js';

/**
 * The recoverer's side: a wallet it was enrolled for, what the chain says
 * about it, and the two things a recoverer can do — ask for recovery to a new
 * owner key, and complete it after the delay.
 */

/** What a recoverer keeps about one wallet. The package holds the recovery credential. */
export interface EnrolledWallet {
  /** The package as opened. */
  signed: SignedMessage;
  /** Unix seconds. */
  importedAt: number;
  acknowledged: boolean;
  /** A name the recoverer gives the wallet's owner. */
  customer: string;
  /** A recovery request that was started and has not been sent. */
  /**
   * `change` is what returns to the fee account when the request is sent, in satoshis. It is worked out when
   * the request is started, because the coins that pay the fee are set aside for the request from then on.
   */
  draft?: { invitationIdentifier: string; startedAt: number; change: string };
  /** The last request sent, kept so that the new device can be given it again. */
  lastRequest?: { transactionId: string; invitation: string; proposedOwnerKeyHash: string; at: number };
  activity: { at: number; summary: string; transactionId: string; invitationIdentifier?: string }[];
}

/** What the recoverer gives a new device: which wallet to take over, where its records are, and the request to join. */
export interface RecoveryTicket {
  version: 1;
  network: string;
  identity: string;
  genesisTransactionId: string;
  archive: EnrollmentPackage['archive'];
  /** The recovery request as started by the recoverer, serialized. */
  invitation: string;
}

export interface DeskDependencies {
  /** Opened with the recovery credential's mnemonic. */
  account: XoAccount;
  chain: AppChain;
  openStore: (url: string) => ArchiveStore;
  save: (enrolled: EnrolledWallet) => void | Promise<void>;
  now?: () => number;
}

export interface DeskView {
  identity: string;
  status: 'active' | 'pending';
  ownerEpoch: number;
  ownerKeyHash: string;
  /** Whether the credential in the package is still the wallet's recoverer. */
  authorized: boolean;
  /** What differs between the package and the wallet as it is now. */
  differences: string[];
  pending?: { proposedOwnerKeyHash: string; requestedIn: string; eligibility: Eligibility };
  /** The recoverer's ordinary coins, which pay its fees. */
  feeBalance: bigint;
  feeNeeded: bigint;
}

export class RecoveryDesk {
  private history!: ControllerHistory;
  private view!: DeskView;

  private constructor(
    private readonly deps: DeskDependencies,
    readonly enrolled: EnrolledWallet,
    readonly enrollment: EnrollmentPackage,
  ) {}

  /** Check a package against the chain before keeping it. */
  static inspect(signed: SignedMessage, chain: AppChain, network: string): Promise<VerifiedEnrollment> {
    return verifyEnrollment(signed, chain, network);
  }

  static async open(deps: DeskDependencies, enrolled: EnrolledWallet): Promise<RecoveryDesk> {
    const verified = await verifyEnrollment(enrolled.signed, deps.chain, parsePackage(enrolled.signed.message).network);
    const desk = new RecoveryDesk(deps, enrolled, verified.enrollment);
    await desk.refresh(verified);
    return desk;
  }

  private now(): number {
    return this.deps.now?.() ?? Math.floor(Date.now() / 1000);
  }

  private get stores(): ArchiveStore[] {
    return this.enrollment.archive.stores.map(this.deps.openStore);
  }

  private async save(): Promise<void> {
    await this.deps.save(this.enrolled);
  }

  private note(summary: string, sent: Pick<Sent, 'transactionId' | 'invitationIdentifier'>): void {
    this.enrolled.activity.unshift({ at: this.now(), summary, transactionId: sent.transactionId, invitationIdentifier: sent.invitationIdentifier });
    this.enrolled.activity.splice(50);
  }

  async refresh(verified?: VerifiedEnrollment): Promise<DeskView> {
    const { chain, account } = this.deps;
    const checked = verified ?? (await verifyEnrollment(this.enrolled.signed, chain, this.enrollment.network));
    this.history = checked.controller;
    const { state } = this.history.current;
    const coins = await account.coins();
    const last = this.history.transactions.at(-1);
    let pending: DeskView['pending'];
    if (state.proposedOwnerKeyHash !== undefined && last !== undefined) {
      const entry = (await chain.getHistory(this.history.current.utxo.output.lockingBytecode)).find((item) => item.transactionId === last.transactionId);
      pending = {
        proposedOwnerKeyHash: hex(state.proposedOwnerKeyHash),
        requestedIn: last.transactionId,
        eligibility: await recoveryEligibility(chain, entry?.height ?? 0, state.challengeDelay),
      };
    }
    this.view = {
      identity: this.enrollment.identity,
      status: state.status,
      ownerEpoch: state.ownerEpoch,
      ownerKeyHash: hex(state.ownerKeyHash),
      authorized: checked.credentialAuthorized,
      differences: checked.differences,
      ...(pending === undefined ? {} : { pending }),
      feeBalance: coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n),
      feeNeeded: controllerFee(coins) + 546n,
    };
    return this.view;
  }

  get current(): DeskView {
    return this.view;
  }

  /** Tell the owner's wallet the package arrived, by a signed note in the wallet's archive. */
  async acknowledge(): Promise<void> {
    await acknowledgeEnrollment(this.enrolled.signed, this.stores, this.now());
    this.enrolled.acknowledged = true;
    await this.save();
  }

  /** What a new device would find if it took the wallet over now. Changes nothing. */
  preview(): Promise<RestoreReport> {
    return restore({
      network: this.enrollment.network,
      identity: this.enrollment.identity,
      genesisTransactionId: this.enrollment.genesisTransactionId,
      archiveId: hexToBin(this.enrollment.archive.archiveId),
      contentKey: hexToBin(this.enrollment.archive.contentKey),
      chain: this.deps.chain,
      stores: this.stores,
    });
  }

  private controllerInput(inputIdentifier: string) {
    return { ...outpointOf(this.history.current.utxo), inputIdentifier };
  }

  private async feeCoins() {
    const coins = await this.deps.account.coins();
    const total = coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
    const fee = controllerFee(coins);
    if (total < fee + 546n) {
      throw new Error(`The fee account holds ${total} satoshis; ${fee + 546n} are needed. Add coins to the fee address and try again.`);
    }
    return { coins: coins.map(({ transactionId, index }) => ({ transactionId, index })), change: total - fee };
  }

  /**
   * Start a recovery request. The result goes to the new device, which adds the key it has made;
   * nothing is sent to the network yet.
   */
  async startRequest(): Promise<RecoveryTicket> {
    await this.refresh();
    if (!this.view.authorized) throw new Error('This recovery credential is no longer the wallet\'s recoverer.');
    if (this.view.status === 'pending') throw new Error('A recovery request is already open for this wallet.');
    const { account } = this.deps;
    // A request started earlier and never sent still holds the fee coins.
    if (this.enrolled.draft !== undefined) {
      await account.discard(this.enrolled.draft.invitationIdentifier);
      delete this.enrolled.draft;
      await this.save();
    }
    const { coins, change } = await this.feeCoins();
    // The recoverer's key exists only as a hash in the wallet until its first request, when the account derives it.
    const firstTime = !(await account.hasKey('recovererKey'));
    if (!firstTime) await waitUntilSeen(account, [this.controllerInput('')]);
    const started = await account.start({
      action: 'requestRecovery',
      role: 'recoverer',
      ...(firstTime ? { generate: ['recovererKey'] } : {}),
      variables: {
        identity: this.enrollment.identity,
        controllerState: hex(encodeControllerState(this.history.current.state)),
        controllerSatoshis: sats(this.history.current.utxo.output.valueSatoshis),
      },
      inputs: [this.controllerInput('claimControllerInput'), ...coins],
    });
    this.enrolled.draft = { invitationIdentifier: started.invitationIdentifier, startedAt: this.now(), change: change.toString() };
    await this.save();
    const { network, identity, genesisTransactionId, archive } = this.enrollment;
    return { version: 1, network, identity, genesisTransactionId, archive, invitation: started.invitation };
  }

  /**
   * Take the request back from the new device, sign it and send it. Returns the request as sent, which
   * the new device needs once more.
   */
  async sendRequest(joinedInvitation: string): Promise<{ sent: Sent; proposedOwnerKeyHash: string }> {
    await this.refresh();
    if (this.view.status === 'pending') throw new Error('A recovery request is already open for this wallet.');
    const { account, chain } = this.deps;
    const { draft } = this.enrolled;
    if (draft === undefined) throw new Error('No request has been started for this wallet from this page. Start one first.');
    const { change } = draft;
    let sent: Sent;
    try {
      const built = await account.continue({
        invitation: joinedInvitation,
        outputs: ['pendingControllerOutput'],
        rawOutputs: [{ lockingBytecode: account.coinLockingBytecode, satoshis: change }],
        build: true,
      });
      sent = await checkAndSend(account, chain, built);
    } catch (error) {
      // The request cannot be used again; the next one starts afresh, with the new device joining anew.
      await account.discard(draft.invitationIdentifier);
      delete this.enrolled.draft;
      await this.save();
      throw error;
    }
    // What the request did is read from the transaction itself, not from a server that may not have it yet.
    const requested = followController(this.history.current, sent.transaction, hexToBin(sent.transactionId)).state.proposedOwnerKeyHash;
    if (requested === undefined) throw new Error('The transaction that was sent is not a recovery request.');
    const proposed = hex(requested);
    delete this.enrolled.draft;
    this.enrolled.lastRequest = { transactionId: sent.transactionId, invitation: sent.invitation, proposedOwnerKeyHash: proposed, at: this.now() };
    this.note('Requested recovery to a new device', sent);
    await this.save();
    await this.refresh().catch(() => undefined);
    return { sent, proposedOwnerKeyHash: proposed };
  }

  /**
   * Complete the recovery: the proposed key becomes the wallet's owner.
   * @throws NotYetValidError while the delay has not passed
   */
  async complete(): Promise<Sent> {
    await this.refresh();
    if (this.view.status !== 'pending') throw new Error('There is no recovery request to complete.');
    const { account, chain } = this.deps;
    // An earlier attempt that was not sent, for example because it was early, still holds the fee coins.
    await account.discardAll('finalizeRecovery');
    const { coins, change } = await this.feeCoins();
    const { state } = this.history.current;
    await waitUntilSeen(account, [this.controllerInput('')]);
    const built = await account.start({
      action: 'finalizeRecovery',
      role: 'recoverer',
      variables: {
        identity: this.enrollment.identity,
        nextControllerState: hex(encodeControllerState(afterFinalizeRecovery(state))),
        challengeSequence: encodeChallengeDelay(state.challengeDelay),
        controllerSatoshis: sats(this.history.current.utxo.output.valueSatoshis),
      },
      inputs: [this.controllerInput('finalizeControllerInput'), ...coins],
      outputs: ['nextControllerOutput'],
      rawOutputs: [{ lockingBytecode: account.coinLockingBytecode, satoshis: String(change) }],
    });
    const sent = await checkAndSend(account, chain, built);
    this.note('Completed the recovery', sent);
    await this.save();
    await this.refresh();
    return sent;
  }
}

/** Read a wallet's controller without a package, for showing what a link refers to. */
export const lookUpWallet = (chain: AppChain, identity: string, genesisTransactionId?: string): Promise<ControllerHistory> =>
  readControllerHistory(chain, hexToBin(identity), genesisTransactionId);
