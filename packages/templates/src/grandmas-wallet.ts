import { assetBytecodeHex } from '@grandmas-wallet/contracts/asset';
import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import type { XOTemplate } from '@xo-cash/types';

/**
 * The XO template for Grandma's Wallet.
 *
 * One template serves every wallet: the wallet identity is a variable, and it is part of the controller
 * and wallet scripts, so each wallet has its own addresses.
 *
 * Applications are separate templates. Their outputs hold no key: they are released when the wallet's
 * owner approves a transaction through the controller, which is what the `approve` action is for.
 *
 * The XO engine derives keys under the template identifier, which is a hash of this content. Any change
 * here, including to a description, gives every account different keys. A wallet is therefore tied to the
 * frozen copy of the template it was created with (see `frozen/`), and a later version needs the owner key
 * to be replaced on chain.
 */

const ZERO_KEY_HASH = '00'.repeat(20);

const one = (role: string) => ({ role, slots: { min: 1, max: 1 } });

/** Bytes 2 to 49 of the current controller state as hex text: owner epoch, owner, recoverer, challenge delay. */
const STATE_BODY = '<controllerState> <4> OP_SPLIT OP_NIP <94> OP_SPLIT OP_DROP';

const identityToken = (commitment: string) => ({
  category: '$(<identity>)',
  amount: null,
  nft: { capability: 'mutable', commitment },
});

/**
 * Token fields are evaluated as text, so a controller state is put together by joining pieces of hex text.
 * Nothing can be hashed or computed there; the wallet supplies key hashes and, where a state cannot be
 * derived from the current one, the whole next state. The controller contract is what enforces that a
 * state is correct.
 */
const COMMITMENT = {
  /** A new wallet: version 1, no claim, owner epoch 0. */
  initial: `$(<"010000000000"> <ownerKeyHash> OP_CAT <recovererKeyHash> OP_CAT <challengeDelay> OP_CAT <"${ZERO_KEY_HASH}"> OP_CAT)`,
  /** The current state with any recovery claim cleared. */
  active: `$(<"0100"> stateBody OP_CAT <"${ZERO_KEY_HASH}"> OP_CAT)`,
  /** The current state with a recovery claim naming the proposed owner. */
  pending: '$(<"0101"> stateBody OP_CAT <proposedOwnerKeyHash> OP_CAT)',
  /** A state the wallet computed: after a completed recovery or a change of recovery settings. */
  supplied: '$(<nextControllerState>)',
};

const controllerOutput = (name: string, description: string, commitment: string) => ({
  name,
  description,
  icon: 'shield',
  lockingScript: 'controllerLockingScript',
  valueSatoshis: '$(<controllerSatoshis>)',
  token: identityToken(commitment),
});

const ownerSpend = (name: string, description: string, icon: string, variables: string[], transaction: string) => ({
  name,
  description,
  icon,
  roles: {
    owner: {
      requirements: { variables: ['identity', 'controllerState', 'controllerSatoshis', ...variables], secrets: ['ownerKey'] },
    },
  },
  requirements: { participants: [one('owner')] },
  transaction,
});

const CONTROLLER_AT_START = { inputIndex: 0 } as const;
const CONTROLLER_FIRST = { outputIndex: 0 } as const;

export const grandmasWalletTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: "Grandma's Wallet",
  description:
    'A wallet whose owner key can be replaced by a trusted recoverer, but only after a recovery request has stayed unchallenged on chain for a set delay. The owner spends alone in normal use and can cancel a request at any time before the delay ends. Funds and savings positions stay where they are when the owner key changes.',
  icon: 'wallet',
  version: '1',
  supported: ['BCH_2026_05'],

  roles: {
    owner: {
      name: 'Owner',
      description: 'Holds the owner key. Spends from the wallet, cancels recovery requests and changes the recovery settings.',
      icon: 'owner',
    },
    recoverer: {
      name: 'Recoverer',
      description:
        'A trusted person or service that can install a new owner key after an unchallenged delay. Cannot spend the wallet\'s funds.',
      icon: 'guardian',
    },
  },

  start: [{ action: 'createWallet', role: 'owner', generate: ['ownerKey'] }],

  defaults: {
    // Receiving and change both go to the wallet's one address.
    receive: { output: 'receivedFundsOutput', role: 'owner' },
    change: { output: 'changeOutput', role: 'owner' },
    address: { lockingScript: 'walletLockingScript', role: 'owner' },
  },

  actions: {
    createWallet: {
      name: 'Set up wallet',
      description:
        'Create the wallet with its recovery settings and first funds. The recoverer does not need to take part.',
      icon: 'wallet',
      roles: {
        owner: {
          generate: ['ownerKey'],
          requirements: {
            variables: [
              'identity',
              'ownerKeyHash',
              'recovererKeyHash',
              'challengeDelay',
              'controllerSatoshis',
              'receivedSatoshis',
            ],
            secrets: ['ownerKey'],
          },
        },
      },
      requirements: { participants: [one('owner')] },
      transaction: 'createWalletTransaction',
    },
    send: ownerSpend(
      'Send',
      'Pay from the wallet. If a recovery request is pending, sending also cancels it.',
      'send',
      ['sentSatoshis', 'recipientLockingScript', 'changeSatoshis'],
      'sendTransaction',
    ),
    cancelRecovery: ownerSpend(
      'Cancel recovery',
      'Cancel a pending recovery request. The wallet stays with its current owner.',
      'cancel',
      ['changeSatoshis'],
      'cancelRecoveryTransaction',
    ),
    approve: {
      name: 'Approve',
      description:
        'Approve a transaction that spends outputs of an application bound to this wallet, such as a savings jar. The application\'s own rules still apply. If a recovery request is pending, approving also cancels it.',
      icon: 'approve',
      roles: {
        owner: { requirements: { variables: ['identity', 'controllerState', 'controllerSatoshis'], secrets: ['ownerKey'] } },
      },
      requirements: { participants: [one('owner')] },
      transaction: 'approveTransaction',
    },
    updateRecovery: {
      name: 'Change recovery settings',
      description:
        'Replace the owner key, the recoverer or the challenge delay. Cancels any pending recovery request. The fee is paid from funds outside the wallet.',
      icon: 'settings',
      roles: {
        owner: {
          requirements: {
            variables: [
              'identity',
              'nextControllerState',
              'newOwnerKeyHash',
              'newRecovererKeyHash',
              'newChallengeDelay',
              'controllerSatoshis',
            ],
            secrets: ['ownerKey'],
          },
        },
      },
      requirements: { participants: [one('owner')] },
      transaction: 'updateRecoveryTransaction',
    },
    requestRecovery: {
      name: 'Request recovery',
      description:
        'Ask for the wallet to be handed to a new owner key. The new owner\'s device joins to provide its key. The request can be completed only after the challenge delay, and the current owner can cancel it until then.',
      icon: 'recover',
      roles: {
        recoverer: {
          name: 'Open the request',
          description: 'Open the recovery request and pay its fee.',
          requirements: { variables: ['identity', 'controllerState', 'controllerSatoshis'], secrets: ['recovererKey'] },
        },
        owner: {
          name: 'Become the new owner',
          description: 'Create the key that will own the wallet once recovery is complete.',
          generate: ['ownerKey'],
          requirements: { variables: ['proposedOwnerKeyHash'], secrets: ['ownerKey'] },
        },
      },
      requirements: { participants: [one('recoverer'), one('owner')] },
      transaction: 'requestRecoveryTransaction',
    },
    finalizeRecovery: {
      name: 'Complete recovery',
      description:
        'Install the new owner key named in the recovery request. Possible only when the challenge delay has passed without the request being cancelled.',
      icon: 'recover',
      roles: {
        recoverer: {
          requirements: {
            variables: ['identity', 'nextControllerState', 'challengeSequence', 'controllerSatoshis'],
            secrets: ['recovererKey'],
          },
        },
      },
      requirements: { participants: [one('recoverer')] },
      transaction: 'finalizeRecoveryTransaction',
    },
  },

  transactions: {
    createWalletTransaction: {
      name: 'Wallet set up',
      description: 'The wallet was created with $(<receivedSatoshis>) satoshis.',
      icon: 'wallet',
      inputs: [],
      outputs: [{ output: 'newControllerOutput', ...CONTROLLER_FIRST }, { output: 'receivedFundsOutput' }],
      version: 2,
      locktime: 0,
    },
    sendTransaction: {
      name: 'Sent',
      description: '$(<sentSatoshis>) satoshis were sent from the wallet.',
      icon: 'send',
      inputs: [{ input: 'ownerControllerInput', ...CONTROLLER_AT_START }, { input: 'walletInput' }],
      outputs: [{ output: 'activeControllerOutput', ...CONTROLLER_FIRST }, { output: 'paymentOutput' }, { output: 'changeOutput' }],
      version: 2,
      locktime: 0,
    },
    cancelRecoveryTransaction: {
      name: 'Recovery cancelled',
      description: 'A recovery request was cancelled by the owner.',
      icon: 'cancel',
      inputs: [{ input: 'ownerControllerInput', ...CONTROLLER_AT_START }, { input: 'walletInput' }],
      outputs: [{ output: 'activeControllerOutput', ...CONTROLLER_FIRST }, { output: 'changeOutput' }],
      version: 2,
      locktime: 0,
    },
    approveTransaction: {
      name: 'Approved',
      description: 'The owner approved a transaction for an application bound to this wallet.',
      icon: 'approve',
      // The application's inputs and outputs follow the controller. The locktime is left to the invitation,
      // since an application may need one.
      inputs: [{ input: 'ownerControllerInput', ...CONTROLLER_AT_START }],
      outputs: [{ output: 'activeControllerOutput', ...CONTROLLER_FIRST }],
      version: 2,
    },
    updateRecoveryTransaction: {
      name: 'Recovery settings changed',
      description: 'The owner changed the wallet\'s recovery settings.',
      icon: 'settings',
      inputs: [{ input: 'updateControllerInput', ...CONTROLLER_AT_START }],
      outputs: [{ output: 'nextControllerOutput', ...CONTROLLER_FIRST }],
      version: 2,
      locktime: 0,
    },
    requestRecoveryTransaction: {
      name: 'Recovery requested',
      description: 'The recoverer asked for the wallet to be handed to a new owner key.',
      icon: 'recover',
      inputs: [{ input: 'claimControllerInput', ...CONTROLLER_AT_START }],
      outputs: [{ output: 'pendingControllerOutput', ...CONTROLLER_FIRST }],
      version: 2,
      locktime: 0,
    },
    finalizeRecoveryTransaction: {
      name: 'Recovery completed',
      description: 'The wallet now belongs to the new owner key.',
      icon: 'recover',
      inputs: [{ input: 'finalizeControllerInput', ...CONTROLLER_AT_START }],
      outputs: [{ output: 'nextControllerOutput', ...CONTROLLER_FIRST }],
      version: 2,
      locktime: 0,
    },
  },

  inputs: {
    ownerControllerInput: {
      name: 'Owner approval',
      description: 'The wallet\'s controller, approving this transaction for the owner.',
      icon: 'shield',
      unlockingScript: 'unlockOwnerAuthorize',
    },
    updateControllerInput: {
      name: 'Owner approval',
      description: 'The wallet\'s controller, taking new recovery settings from the owner.',
      icon: 'shield',
      unlockingScript: 'unlockOwnerUpdate',
    },
    claimControllerInput: {
      name: 'Recovery request',
      description: 'The wallet\'s controller, recording a recovery request by the recoverer.',
      icon: 'shield',
      unlockingScript: 'unlockRequestRecovery',
    },
    finalizeControllerInput: {
      name: 'Recovery completion',
      description: 'The wallet\'s controller, spent only after the challenge delay.',
      icon: 'shield',
      unlockingScript: 'unlockFinalizeRecovery',
      sequenceNumber: '$(<challengeSequence>)',
    },
    walletInput: {
      name: 'Wallet funds',
      description: 'Funds held by the wallet. Released by the owner\'s approval on the controller; they need no signature of their own.',
      icon: 'wallet',
      unlockingScript: 'unlockWalletFunds',
    },
  },

  outputs: {
    newControllerOutput: controllerOutput(
      'Wallet controller',
      'Records the wallet\'s owner, its recoverer and the challenge delay.',
      COMMITMENT.initial,
    ),
    activeControllerOutput: controllerOutput(
      'Wallet controller',
      'The controller, unchanged apart from any recovery request being cleared.',
      COMMITMENT.active,
    ),
    pendingControllerOutput: controllerOutput(
      'Wallet controller',
      'The controller with a recovery request waiting out the challenge delay.',
      COMMITMENT.pending,
    ),
    nextControllerOutput: controllerOutput(
      'Wallet controller',
      'The controller with its new owner or recovery settings.',
      COMMITMENT.supplied,
    ),
    receivedFundsOutput: {
      name: 'Wallet funds',
      description: '$(<receivedSatoshis>) satoshis received into the wallet.',
      icon: 'receive',
      lockingScript: 'walletLockingScript',
      valueSatoshis: '$(<receivedSatoshis>)',
      token: null,
    },
    changeOutput: {
      name: 'Change',
      description: 'Funds returned to the wallet.',
      icon: 'receive',
      lockingScript: 'walletLockingScript',
      valueSatoshis: '$(<changeSatoshis>)',
      token: null,
    },
    paymentOutput: {
      name: 'Payment',
      description: '$(<sentSatoshis>) satoshis sent to the recipient.',
      icon: 'send',
      lockingScript: '$(<recipientLockingScript>)',
      valueSatoshis: '$(<sentSatoshis>)',
    },
  },

  lockingScripts: {
    controllerLockingScript: {
      name: 'Wallet controller',
      description: 'Holds the wallet\'s identity token and enforces who may act for the wallet and when.',
      icon: 'shield',
      lockingType: 'p2sh',
      lockingBytecode: 'controllerBytecode',
      state: { variables: ['identity'] },
      selectable: false,
      roles: {
        owner: {
          state: { secrets: ['ownerKey'] },
          actions: [
            { action: 'send', role: 'owner', secrets: [{ ownerKey: null }] },
            { action: 'cancelRecovery', role: 'owner', secrets: [{ ownerKey: null }] },
            { action: 'approve', role: 'owner', secrets: [{ ownerKey: null }] },
            { action: 'updateRecovery', role: 'owner', secrets: [{ ownerKey: null }] },
          ],
        },
        recoverer: {
          state: { secrets: ['recovererKey'] },
          actions: [
            { action: 'requestRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
            { action: 'finalizeRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
          ],
        },
      },
    },
    walletLockingScript: {
      name: 'Wallet funds',
      description: 'The wallet\'s receiving address. Spendable only in a transaction the wallet\'s current owner approves.',
      icon: 'wallet',
      lockingType: 'p2sh',
      lockingBytecode: 'walletBytecode',
      unlockingBytecode: 'unlockWalletFunds',
      state: { variables: ['identity'] },
      roles: {
        owner: {
          actions: [{ action: 'send', role: 'owner', secrets: [{ ownerKey: null }] }],
          balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true },
          selectable: true,
        },
        recoverer: { relevant: false },
      },
    },
  },

  scripts: {
    // Each contract is its compiled bytecode preceded by its constructor arguments, last argument first.
    // Contracts see a token category in the reverse of the byte order used for the identity elsewhere.
    controllerBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${controllerBytecodeHex}`,
    walletBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${assetBytecodeHex}`,

    // Controller functions take their arguments in reverse order, followed by the function number.
    unlockOwnerAuthorize: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key> <0>',
    unlockRequestRecovery:
      '<proposedOwnerKeyHash> <recovererKey.schnorr_signature.all_outputs> <recovererKey.public_key> <1>',
    unlockFinalizeRecovery: '<recovererKey.schnorr_signature.all_outputs> <recovererKey.public_key> <2>',
    unlockOwnerUpdate:
      '<newChallengeDelay> <newRecovererKeyHash> <newOwnerKeyHash> <ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key> <3>',
    // Wallet funds take no arguments: the script itself is all that is needed to unlock them.
    unlockWalletFunds: '',

    stateBody: STATE_BODY,
  },

  variables: {
    ownerKey: {
      name: 'Owner key',
      description: 'The key that controls the wallet in normal use.',
      type: 'private_key',
    },
    recovererKey: {
      name: 'Recovery key',
      description: 'The key the recoverer uses to request and complete recovery.',
      type: 'private_key',
    },
    identity: {
      name: 'Wallet identity',
      description: 'The token category that identifies the wallet for its whole life.',
      type: 'token_category',
    },
    controllerState: {
      name: 'Current controller state',
      description: 'The 69-byte state currently held by the wallet\'s controller.',
      type: 'bytes',
    },
    nextControllerState: {
      name: 'New controller state',
      description: 'The 69-byte state the controller will hold after this transaction.',
      type: 'bytes',
    },
    ownerKeyHash: {
      name: 'Owner key hash',
      description: 'Hash of the owner\'s public key.',
      type: 'bytes',
    },
    recovererKeyHash: {
      name: 'Recovery key hash',
      description: 'Hash of the recoverer\'s public key.',
      type: 'bytes',
    },
    proposedOwnerKeyHash: {
      name: 'New owner key hash',
      description: 'Hash of the public key that will own the wallet if recovery completes.',
      type: 'bytes',
    },
    newOwnerKeyHash: {
      name: 'Owner key hash after the change',
      description: 'Hash of the owner\'s public key once the new settings apply.',
      type: 'bytes',
    },
    newRecovererKeyHash: {
      name: 'Recovery key hash after the change',
      description: 'Hash of the recoverer\'s public key once the new settings apply.',
      type: 'bytes',
    },
    challengeDelay: {
      name: 'Challenge delay',
      description: 'How long a recovery request must stay unchallenged, as a 3-byte relative locktime.',
      type: 'bytes',
    },
    newChallengeDelay: {
      name: 'Challenge delay after the change',
      description: 'The challenge delay once the new settings apply, as a 3-byte relative locktime.',
      type: 'bytes',
    },
    challengeSequence: {
      name: 'Challenge delay as a sequence number',
      description: 'The wallet\'s challenge delay in the form a completing transaction must carry.',
      type: 'integer',
    },
    controllerSatoshis: {
      name: 'Controller amount',
      description: 'The small amount of satoshis the controller carries. It never decreases.',
      type: 'satoshis',
    },
    receivedSatoshis: {
      name: 'Amount received',
      description: 'Satoshis going into the wallet.',
      type: 'satoshis',
    },
    sentSatoshis: {
      name: 'Amount to send',
      description: 'Satoshis to pay to the recipient.',
      type: 'satoshis',
    },
    changeSatoshis: {
      name: 'Change',
      description: 'Satoshis returning to the wallet.',
      type: 'satoshis',
    },
    recipientLockingScript: {
      name: 'Recipient',
      description: 'Where the payment goes.',
      type: 'locking_script',
    },
  },
} satisfies XOTemplate;
