// A trial XO template wrapping the real controller and asset contracts.
import { readFileSync } from 'node:fs';

const hexOf = (name) =>
  /'([0-9a-f]+)'/.exec(readFileSync(new URL(`../../contracts/artifacts/${name}.ts`, import.meta.url), 'utf8'))[1];

const view = (name, description = name) => ({ name, description });
const one = (role) => ({ role, slots: { min: 1, max: 1 } });
const ZERO20 = '0x' + '00'.repeat(20);

export const spikeTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Recovery controller (spike)', 'Trial template for the Grandma\'s Wallet recovery controller.'),
  version: '0',
  supported: ['BCH_2026_05'],
  roles: {
    owner: view('Owner', 'Controls the wallet in normal use.'),
    recoverer: view('Recoverer', 'Can replace the owner after an unchallenged delay.'),
  },
  start: [{ action: 'initialize', role: 'owner', generate: ['ownerKey'] }],
  actions: {
    initialize: {
      ...view('Set up recovery'),
      roles: {
        owner: {
          generate: ['ownerKey'],
          requirements: { variables: ['identity', 'ownerKeyHash', 'recovererKeyHash', 'walletSatoshis'], secrets: ['ownerKey'] },
        },
      },
      requirements: { participants: [one('owner')] },
      transaction: 'initializeTransaction',
    },
    send: {
      ...view('Send'),
      roles: {
        owner: {
          generate: ['ownerKey'],
          requirements: {
            variables: ['identity', 'stateBody', 'sentSatoshis', 'recipientLockingScript'],
            secrets: ['ownerKey'],
          },
        },
      },
      requirements: { participants: [one('owner')] },
      transaction: 'sendTransaction',
    },
    requestRecovery: {
      ...view('Request recovery'),
      roles: {
        recoverer: {
          generate: ['recovererKey'],
          requirements: { variables: ['identity', 'stateBody', 'proposedOwnerKeyHash'], secrets: ['recovererKey'] },
        },
      },
      requirements: { participants: [one('recoverer')] },
      transaction: 'requestRecoveryTransaction',
    },
    finalizeRecovery: {
      ...view('Finalize recovery'),
      roles: {
        recoverer: {
          generate: ['recovererKey'],
          requirements: { variables: ['identity', 'finalizedState', 'challengeSequence'], secrets: ['recovererKey'] },
        },
      },
      requirements: { participants: [one('recoverer')] },
      transaction: 'finalizeRecoveryTransaction',
    },
  },
  transactions: {
    initializeTransaction: {
      ...view('Recovery set up'),
      inputs: [],
      outputs: [{ output: 'initialControllerOutput', outputIndex: 0 }, { output: 'walletOutput' }],
      version: 2,
      locktime: 0,
    },
    sendTransaction: {
      ...view('Sent'),
      inputs: [{ input: 'controllerOwnerInput', inputIndex: 0 }, { input: 'walletInput' }],
      outputs: [{ output: 'activeControllerOutput', outputIndex: 0 }, { output: 'paymentOutput' }],
      version: 2,
      locktime: 0,
    },
    requestRecoveryTransaction: {
      ...view('Recovery requested'),
      inputs: [{ input: 'controllerClaimInput', inputIndex: 0 }],
      outputs: [{ output: 'pendingControllerOutput', outputIndex: 0 }],
      version: 2,
      locktime: 0,
    },
    finalizeRecoveryTransaction: {
      ...view('Recovery finalized'),
      inputs: [{ input: 'controllerFinalizeInput', inputIndex: 0 }],
      outputs: [{ output: 'finalizedControllerOutput', outputIndex: 0 }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: {
    controllerOwnerInput: { ...view('Controller'), unlockingScript: 'unlockOwnerAuthorize' },
    controllerClaimInput: { ...view('Controller'), unlockingScript: 'unlockRequestRecovery' },
    controllerFinalizeInput: {
      ...view('Controller'),
      unlockingScript: 'unlockFinalizeRecovery',
      sequenceNumber: '$(<challengeSequence>)',
    },
    walletInput: { ...view('Wallet funds'), unlockingScript: 'unlockAsset' },
  },
  // Token fields are evaluated as text: variables are inserted as their hex text, so a commitment can be
  // assembled by concatenating hex text inside one evaluation, but nothing can be computed (no hashing, no byte operations).
  outputs: {
    initialControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: `$(<"010000000000"> <ownerKeyHash> OP_CAT <recovererKeyHash> OP_CAT <"010040${ZERO20.slice(2)}"> OP_CAT)` } },
    },
    activeControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: `$(<"0100"> <stateBody> OP_CAT <"${ZERO20.slice(2)}"> OP_CAT)` } },
    },
    pendingControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: '$(<"0101"> <stateBody> OP_CAT <proposedOwnerKeyHash> OP_CAT)' } },
    },
    finalizedControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: '$(<finalizedState>)' } },
    },
    walletOutput: {
      ...view('Wallet funds'),
      lockingScript: 'assetLockingScript',
      valueSatoshis: '$(<walletSatoshis>)',
      token: null,
    },
    paymentOutput: {
      ...view('Payment'),
      lockingScript: '$(<recipientLockingScript>)',
      valueSatoshis: '$(<sentSatoshis>)',
    },
  },
  lockingScripts: {
    controllerLockingScript: {
      ...view('Recovery controller'),
      lockingType: 'p2sh',
      lockingBytecode: 'controllerBytecode',
      state: { variables: ['identity'] },
      roles: {
        owner: { state: { secrets: ['ownerKey'] }, actions: [{ action: 'send', role: 'owner', secrets: [{ ownerKey: null }] }] },
        recoverer: {
          state: { secrets: ['recovererKey'] },
          actions: [
            { action: 'requestRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
            { action: 'finalizeRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
          ],
        },
      },
    },
    assetLockingScript: {
      ...view('Wallet funds'),
      lockingType: 'p2sh',
      lockingBytecode: 'assetBytecode',
      state: { variables: ['identity'] },
      roles: {
        owner: {
          state: { secrets: ['ownerKey'] },
          balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true },
          selectable: true,
        },
      },
    },
  },
  scripts: {
    // Constructor argument (identity as contracts see it), then the compiled contract.
    controllerBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${hexOf('controller')}`,
    assetBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${hexOf('asset')}`,
    // version, status, epoch | owner | recoverer | delay | proposed owner
    unlockOwnerAuthorize: '<ownerKey.schnorr_signature.all_outputs_all_utxos> <ownerKey.public_key> <0>',
    unlockRequestRecovery:
      '<proposedOwnerKeyHash> <recovererKey.schnorr_signature.all_outputs_all_utxos> <recovererKey.public_key> <1>',
    unlockFinalizeRecovery: '<recovererKey.schnorr_signature.all_outputs_all_utxos> <recovererKey.public_key> <2>',
    unlockAsset: '<ownerKey.schnorr_signature.all_outputs_all_utxos> <ownerKey.public_key>',
  },
  variables: {
    ownerKey: { ...view('Owner key'), type: 'private_key' },
    recovererKey: { ...view('Recoverer key'), type: 'private_key' },
    identity: { ...view('Wallet identity'), type: 'token_category' },
    ownerKeyHash: { ...view('Owner key hash'), type: 'bytes' },
    recovererKeyHash: { ...view('Recoverer key hash'), type: 'bytes' },
    proposedOwnerKeyHash: { ...view('Proposed owner key hash'), type: 'bytes' },
    stateBody: { ...view('Current controller state'), type: 'bytes' },
    finalizedState: { ...view('Controller state after recovery'), type: 'bytes' },
    challengeSequence: { ...view('Challenge delay sequence number'), type: 'integer' },
    walletSatoshis: { ...view('Initial wallet funds'), type: 'satoshis' },
    sentSatoshis: { ...view('Amount to send'), type: 'satoshis' },
    recipientLockingScript: { ...view('Recipient'), type: 'locking_script' },
  },
};
