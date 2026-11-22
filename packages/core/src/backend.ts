import type { Output } from '@bitauth/libauth';

import type { Utxo } from './builder.js';
import type { KeyedAddressKind } from './keys.js';
import type { CommitPart } from './shared-invitation.js';
import type { TemplateValues } from './template.js';
import type { RecoverableWalletAddress, VaultWalletAddress } from './wallet-addresses.js';

/**
 * What the wallet's logic needs from whatever holds the keys, follows scripts and builds transactions.
 *
 * In the wallet this is an account of the XO engine with the wallet's templates. In tests it can be this
 * project's own builder with the same keys, on a simulated chain. The wallet's logic decides which coins
 * a transaction spends and what its outputs are, to the satoshi; the backend builds exactly that, signs
 * it, and checks it before it is sent (proposal section 13.2).
 */

export type Role = 'owner' | 'recoverer';

/** The wallet's templates, by the name the wallet's code uses for each. */
export type WalletTemplateName = 'controller' | 'givenOut' | 'change' | 'actions' | 'coins';

/** A coin the backend follows. */
export interface AccountCoin {
  utxo: Utxo;
  /** Which of the wallet's templates the coin's script belongs to, or the identifier of another template. */
  template: WalletTemplateName | string;
  /** The height of the block that holds it; 0 or less while unconfirmed. */
  height: number;
}

/** What a transaction is to be, as the wallet's code decides it. */
export interface TransactionRequest {
  /**
   * The template whose action the transaction is: one of the wallet's own by its name, or a template that
   * was brought to the backend with `importTemplate`, by its identifier. Inputs and outputs of other
   * templates can be part of it.
   */
  template: WalletTemplateName | string;
  action: string;
  /** The role the account takes: `owner` or `recoverer` in the wallet's templates, a role of its own in another template. */
  role: Role | string;
  /** Values for the template's variables: bytes as hex, amounts as whole numbers. */
  variables?: Record<string, string | number | bigint>;
  /**
   * The coins the transaction spends, in order. A coin of the action's own template names the template
   * input it stands for; a coin of another template is unlocked the way its own script says.
   */
  inputs: { coin: AccountCoin; inputIdentifier?: string; unlocking?: GivenUnlocking }[];
  /** The outputs, in order: an output of the template by name, or any output given whole. */
  outputs: ({ outputIdentifier: string } | Output)[];
}

/**
 * The unlocking of a coin of an application's contract, worked out by the wallet from the template: a coin that
 * needs no key of the account, at a script the key holder does not follow. The key holder puts it into the
 * transaction as it is.
 */
export interface GivenUnlocking {
  bytecode: Uint8Array;
  sequenceNumber: number;
}

/** A transaction that is signed and checked, and not yet sent. */
export interface PreparedTransaction {
  /** The backend's handle to it. */
  invitationIdentifier: string;
  transactionId: string;
  transactionHex: string;
  bytes: number;
  feeSatoshis: bigint;
}

/**
 * An invitation another participant joins: the wallet starts it with its own part, sends it, takes it back with the
 * other participant's part, and finishes it with its fee and change (docs/xo-service.md). The wallet's code checks
 * what the other participant added between taking and finishing; the backend takes nothing on trust beyond what
 * the engine itself checks.
 */
export interface SharedActionStart {
  /** An imported template, by its identifier. */
  template: string;
  action: string;
  /** The role the wallet takes. Its values are tagged with it. */
  role: string;
  /** The wallet's own values: bytes as hex, amounts as whole numbers. */
  variables?: Record<string, string | number | bigint>;
  /**
   * The coins the wallet brings in its first commit, such as the token the action is about, in order. A coin that
   * stands for a template input names it. A coin given a place goes there in the transaction; one without a place is
   * put where the template's places and the order of the wallet's items put it.
   */
  inputs: { coin: AccountCoin; inputIdentifier?: string; place?: number }[];
}

/** An invitation the wallet started, ready to be sent. */
export interface SharedInvitationStarted {
  /** The backend's handle to it, as for a prepared transaction. */
  invitationIdentifier: string;
  /** The invitation in XO's own serialization, as it is sent. */
  text: string;
}

/** The invitation as the backend took it back: the wallet's own commits and those the other participant added. */
export interface SharedInvitationTaken {
  invitationIdentifier: string;
  own: CommitPart[];
  others: CommitPart[];
}

/** The wallet's part after the other participant's. */
export interface SharedActionFinish {
  invitationIdentifier: string;
  /**
   * The wallet's coins that pay, after the coins of its first commit, in order. A coin that stands for a template
   * input names it. A coin given a place goes there in the transaction.
   */
  inputs: { coin: AccountCoin; inputIdentifier?: string; place?: number }[];
  /**
   * The wallet's outputs, in order after the other participant's: an output of the template in the wallet's role by
   * name, or any output given whole, such as its change at the exact fee. An output given a place goes there.
   */
  outputs: (({ outputIdentifier: string } | Output) & { place?: number })[];
  /** The other participant's coins as the wallet read them from the chain, for the check before sending. */
  theirCoins: Utxo[];
}

/** Why the backend did not take an invitation back. */
export class InvitationNotTakenError extends Error {
  constructor(
    message: string,
    /**
     * `not-started`: the backend holds no such invitation of its own; `changed`: it is not the invitation that was
     * sent with something appended; `not-valid`: the engine refused it (a signature, the history, a value an
     * earlier commit set).
     */
    readonly code: 'not-started' | 'changed' | 'not-valid',
  ) {
    super(message);
    this.name = 'InvitationNotTakenError';
  }
}

export interface SharedActionBackend {
  /**
   * Start an invitation for an action of an imported template: the wallet's values, tagged with its role, and the
   * coins it brings, which are held for it. Nothing is signed.
   */
  startShared(request: SharedActionStart): Promise<SharedInvitationStarted>;
  /**
   * Take back the invitation the other participant joined: it has to be the one that was sent with commits
   * appended, and the engine checks every signature and the history. Nothing is judged beyond that.
   * @throws InvitationNotTakenError
   */
  takeShared(invitationIdentifier: string, text: string): Promise<SharedInvitationTaken>;
  /**
   * Add the wallet's coins and outputs, sign the wallet's inputs, build, and check the transaction before it is
   * sent, as `prepare` does. Nothing is sent: the result goes to `send` like any prepared transaction.
   * @throws if the engine cannot build it, or if it fails the check before sending; the invitation is then put aside
   */
  finishShared(request: SharedActionFinish): Promise<PreparedTransaction>;
  /** Put the invitation aside and free the coins it held: on a refusal, a failure or a time limit. */
  abandonShared(invitationIdentifier: string): Promise<void>;
}

export interface WalletBackend extends SharedActionBackend {
  /** The account's key for the controller: the first key under the controller template. The same seed always gives the same one. */
  controllerKey(role: Role): Promise<{ publicKey: Uint8Array; keyHash: Uint8Array }>;
  /** The account's address for ordinary coins: the funding address of an owner, the fee address of a recoverer. */
  ordinaryAddress(): Promise<Uint8Array>;
  /** Make the controller of an identity known, under the key the account already has. */
  knowController(identity: Uint8Array, role: Role, currentState?: Uint8Array): Promise<Uint8Array>;
  /** The next address of a kind, with the tag the wallet's code supplies. Numbers are handed out in order from 0. */
  nextAddress(kind: KeyedAddressKind, tag: Uint8Array): Promise<{ lockingBytecode: Uint8Array; number: number }>;
  /** How many addresses of a kind this account has made so far: the number the next one gets. */
  addressCount(kind: KeyedAddressKind): Promise<number>;
  /** Make an address of an earlier seed known: it can be followed and swept, and not spent by key. */
  knowEarlierAddress(identity: Uint8Array, address: RecoverableWalletAddress): Promise<Uint8Array>;
  knowVaultAddress(identity: Uint8Array, address: VaultWalletAddress): Promise<Uint8Array>;
  /** Every coin the account follows, with its script and its tokens. */
  coins(): Promise<AccountCoin[]>;
  /** Build and sign a transaction, and check it. Nothing is sent. */
  prepare(request: TransactionRequest): Promise<PreparedTransaction>;
  /** Send a prepared transaction. Returns its identifier. */
  send(prepared: PreparedTransaction): Promise<string>;
  /** Put aside a transaction that will not be sent, so that the coins it named can be used again. */
  discard(invitationIdentifier: string): Promise<void>;
  /**
   * Take in a template that is not the wallet's own, from its text. Returns the template's identifier.
   * Taking in the same template again changes nothing.
   */
  importTemplate(text: string): Promise<string>;
  /**
   * Make a script of an imported template known, so that the coins there are followed and can be spent in
   * an action of that template. Such a script holds no key of the account.
   */
  followScript(script: FollowedScript): Promise<Uint8Array>;
}

/** A script of an imported template, for the given values. */
export interface FollowedScript {
  /** The template's identifier. */
  template: string;
  lockingScript: string;
  /** The role the account has on the script. */
  role: string;
  variables: TemplateValues;
}
