import { controllerBytecodeHex } from '@grandmas-wallet/contracts/controller';
import { recoverableAddressBytecodeHex } from '@grandmas-wallet/contracts/recoverableAddress';
import { vaultAddressBytecodeHex } from '@grandmas-wallet/contracts/vaultAddress';
import { type TemplateNumbers, xoTemplateIndex } from '@grandmas-wallet/core';
import { p2pkhTemplate } from '@xo-cash/templates';
import type { XOTemplate } from '@xo-cash/types';
import { generateTemplateIdentifier } from '@xo-cash/utils';

/**
 * The wallet's XO templates (proposal section 13.2).
 *
 * The XO engine derives a template's keys under the template's number, which follows from its content. So:
 *
 * - keys that must not share a branch of the key tree are in different templates: the controller key, the
 *   keys of addresses given out, and the keys of change addresses;
 * - a template that holds keys must never change, not even in a description. A change gives every
 *   account other keys.
 *
 * The fourth template holds no key and may change: the wallet's actions, the address of an earlier seed
 * and the vault address.
 *
 * A template can only join text. What it cannot work out (the controller's next state, each tag, each
 * secret) the wallet's code supplies, and the contracts enforce that it is right.
 */

const view = (name: string, description: string = name) => ({ name, description });
const one = (role: string) => ({ role, slots: { min: 1, max: 1 } });
const SUPPORTED = ['BCH_2026_05'];
const SCHEMA = 'https://libauth.org/schemas/wallet-template-v0.schema.json';
const holds = { balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true };

/**
 * The controller.
 *
 * Owner and recoverer are separate accounts. Each makes one key under this template, the first: the
 * owner's controller key, or the recoverer's recovery key. Every controller output takes its whole state
 * from the wallet's code as `nextState`; the controller's script checks it against the action.
 */
export const controllerTemplate = {
  $schema: SCHEMA,
  ...view('Grandma\'s Wallet controller', 'The recovery controller of a wallet: its identity, its owner, its recoverer and the waiting period.'),
  version: '1',
  supported: SUPPORTED,
  defaults: {
    // Makes the controller of an existing identity known to an account, under the key the account already has.
    address: { lockingScript: 'controllerLockingScript', role: 'owner', variables: [{ identity: null }] },
    receive: { output: 'recovererControllerOutput', role: 'recoverer', variables: [{ identity: null }, { nextState: null }] },
  },
  roles: {
    owner: view('Owner', 'Holds the wallet\'s seed and spends from it.'),
    recoverer: view('Recoverer', 'Can ask for the wallet to go to a new key and, after the waiting period, complete that.'),
  },
  start: [
    { action: 'create', role: 'owner', generate: ['controllerKey'] },
    { action: 'takeUp', role: 'recoverer', generate: ['recovererKey'] },
  ],
  actions: {
    create: {
      ...view('Create the wallet', 'Create the wallet\'s identity and its controller.'),
      roles: { owner: { generate: ['controllerKey'], requirements: { variables: ['identity', 'nextState'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'createTransaction',
    },
    takeUp: {
      ...view('Take up the recoverer\'s key', 'Make the recoverer\'s key known to this account. Nothing is sent.'),
      roles: { recoverer: { generate: ['recovererKey'], requirements: { secrets: ['recovererKey'] } } },
      requirements: { participants: [one('recoverer')] },
      transaction: 'takeUpTransaction',
    },
    approve: {
      ...view('Approve', 'The owner approves a transaction: a cancellation, a sweep, a spend from a vault address.'),
      roles: { owner: { requirements: { variables: ['identity', 'nextState'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'approveTransaction',
    },
    changeSettings: {
      ...view('Change settings', 'The owner replaces the owner key, the recoverer or the waiting period.'),
      roles: { owner: { requirements: { variables: ['identity', 'nextState', 'newOwnerKeyHash', 'newRecovererKeyHash', 'newDelay'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'changeSettingsTransaction',
    },
    close: {
      ...view('Close the wallet', 'The owner ends the wallet\'s identity and takes the controller\'s value. Vault addresses cannot be spent from afterwards.'),
      roles: { owner: { requirements: { variables: ['identity'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'closeTransaction',
    },
    requestRecovery: {
      ...view('Request recovery', 'The recoverer asks for the wallet to go to a new key. The waiting period starts.'),
      roles: { recoverer: { requirements: { variables: ['identity', 'nextState', 'proposedOwnerKeyHash'], secrets: ['recovererKey'] } } },
      requirements: { participants: [one('recoverer')] },
      transaction: 'requestRecoveryTransaction',
    },
    completeRecovery: {
      ...view('Complete recovery', 'After the waiting period the recoverer completes: the key named in the request is the owner.'),
      roles: { recoverer: { requirements: { variables: ['identity', 'nextState', 'waitingSequence'], secrets: ['recovererKey'] } } },
      requirements: { participants: [one('recoverer')] },
      transaction: 'completeRecoveryTransaction',
    },
  },
  transactions: {
    createTransaction: { ...view('Wallet created'), inputs: [], outputs: [{ output: 'controllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    takeUpTransaction: { ...view('Recoverer\'s key taken up'), inputs: [], outputs: [], version: 2, locktime: 0 },
    approveTransaction: { ...view('Approved'), inputs: [{ input: 'approveInput', inputIndex: 0 }], outputs: [{ output: 'controllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    changeSettingsTransaction: { ...view('Settings changed'), inputs: [{ input: 'changeSettingsInput', inputIndex: 0 }], outputs: [{ output: 'controllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    closeTransaction: { ...view('Wallet closed'), inputs: [{ input: 'closeInput', inputIndex: 0 }], outputs: [], version: 2, locktime: 0 },
    requestRecoveryTransaction: { ...view('Recovery requested'), inputs: [{ input: 'requestInput', inputIndex: 0 }], outputs: [{ output: 'controllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    completeRecoveryTransaction: { ...view('Recovery completed'), inputs: [{ input: 'completeInput', inputIndex: 0 }], outputs: [{ output: 'controllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
  },
  inputs: {
    approveInput: { ...view('Controller'), unlockingScript: 'unlockApprove' },
    changeSettingsInput: { ...view('Controller'), unlockingScript: 'unlockChangeSettings' },
    closeInput: { ...view('Controller'), unlockingScript: 'unlockClose' },
    requestInput: { ...view('Controller'), unlockingScript: 'unlockRequest' },
    // The waiting period is a relative time lock on the controller's own coin.
    completeInput: { ...view('Controller'), unlockingScript: 'unlockComplete', sequenceNumber: '$(<waitingSequence>)' },
  },
  outputs: {
    controllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: '$(<nextState>)' } },
    },
    // The same output, as the recoverer's account comes to know it.
    recovererControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: { category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment: '$(<nextState>)' } },
    },
  },
  lockingScripts: {
    controllerLockingScript: {
      ...view('Recovery controller'),
      lockingType: 'p2sh',
      lockingBytecode: 'controllerBytecode',
      state: { variables: ['identity'] },
      roles: {
        owner: {
          state: { secrets: ['controllerKey'] },
          actions: [
            { action: 'approve', role: 'owner', secrets: [{ controllerKey: null }] },
            { action: 'changeSettings', role: 'owner', secrets: [{ controllerKey: null }] },
            { action: 'close', role: 'owner', secrets: [{ controllerKey: null }] },
          ],
        },
        recoverer: {
          state: { secrets: ['recovererKey'] },
          actions: [
            { action: 'requestRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
            { action: 'completeRecovery', role: 'recoverer', secrets: [{ recovererKey: null }] },
          ],
        },
      },
    },
  },
  scripts: {
    // The identity as contracts see it, then the compiled contract.
    controllerBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${controllerBytecodeHex}`,
    // Arguments in reverse order, then the number of the contract's function.
    unlockApprove: '<controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <0>',
    unlockRequest: '<proposedOwnerKeyHash> <recovererKey.schnorr_signature.all_outputs> <recovererKey.public_key> <1>',
    unlockComplete: '<recovererKey.schnorr_signature.all_outputs> <recovererKey.public_key> <2>',
    unlockChangeSettings: '<newDelay> <newRecovererKeyHash> <newOwnerKeyHash> <controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <3>',
    unlockClose: '<controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <4>',
  },
  variables: {
    controllerKey: { ...view('Controller key', 'The owner\'s key for the controller. It is used for nothing else.'), type: 'private_key' },
    recovererKey: { ...view('Recovery key', 'The recoverer\'s key for this wallet.'), type: 'private_key' },
    identity: { ...view('Wallet identity', 'The token category of the controller.'), type: 'token_category' },
    nextState: { ...view('Next controller state', 'The 69 bytes of state the controller continues with.'), type: 'bytes' },
    proposedOwnerKeyHash: { ...view('Proposed owner', 'The hash of the key a recovery is requested for.'), type: 'bytes' },
    newOwnerKeyHash: { ...view('New owner key hash'), type: 'bytes' },
    newRecovererKeyHash: { ...view('New recoverer key hash'), type: 'bytes' },
    newDelay: { ...view('New waiting period', 'Three bytes, as the controller stores it.'), type: 'bytes' },
    waitingSequence: { ...view('Waiting period', 'The waiting period as a sequence number.'), type: 'integer' },
  },
} as const satisfies Record<string, unknown>;

/** The template of one kind of recoverable address. The two kinds differ in their name only. */
const addressTemplate = (kind: 'given out' | 'change') =>
  ({
    $schema: SCHEMA,
    ...view(
      kind === 'given out' ? 'Grandma\'s Wallet addresses' : 'Grandma\'s Wallet change',
      kind === 'given out' ? 'Addresses the wallet gives out to be paid.' : 'Addresses for change and for coins an application\'s transaction sends to the wallet.',
    ),
    version: '1',
    supported: SUPPORTED,
    defaults: {
      // A new address: the next key of this template and the tag the wallet's code supplies.
      address: { lockingScript: 'addressLockingScript', role: 'owner', generate: ['addressKey'], variables: [{ tag: null }] },
    },
    roles: { owner: view('Owner', 'Holds the wallet\'s seed and spends from it.') },
    start: [],
    actions: {},
    transactions: {},
    inputs: { spendInput: { ...view('Coin', 'A coin of the wallet, spent by the key of its address.'), unlockingScript: 'unlockSpend' } },
    outputs: {},
    lockingScripts: {
      addressLockingScript: {
        ...view('Recoverable address', 'Spent by its own key; the wallet\'s current owner can also move it through the controller.'),
        lockingType: 'p2sh',
        lockingBytecode: 'addressBytecode',
        unlockingBytecode: 'unlockSpend',
        state: { variables: ['tag'] },
        roles: { owner: { state: { secrets: ['addressKey'] }, ...holds, actions: [] } },
      },
    },
    scripts: {
      // The contract's arguments, last first: the key hash, the tag; then the compiled contract.
      addressBytecode: `<$(<addressKey.public_key> OP_HASH160)> <tag> 0x${recoverableAddressBytecodeHex}`,
      unlockSpend: '<addressKey.schnorr_signature.all_outputs> <addressKey.public_key> <0>',
    },
    variables: {
      addressKey: { ...view('Address key', 'The key of one address.'), type: 'private_key' },
      tag: { ...view('Address tag', 'Ties the address to the wallet without showing which.'), type: 'bytes' },
    },
  }) as const satisfies Record<string, unknown>;

export const givenOutTemplate = addressTemplate('given out');
export const changeTemplate = addressTemplate('change');

/**
 * What needs no key of its own: the wallet's payments, the recoverable address of an earlier seed (which
 * this account can follow and sweep, and cannot spend by key), and the vault address. This template may
 * change between versions of the wallet.
 */
export const walletActionsTemplate = {
  $schema: SCHEMA,
  ...view('Grandma\'s Wallet actions', 'Payments from the wallet\'s addresses, addresses of an earlier seed, and vault addresses.'),
  version: '1',
  supported: SUPPORTED,
  defaults: {
    // An address of an earlier seed: its key hash and tag are given; it can only be swept.
    address: { lockingScript: 'earlierAddressLockingScript', role: 'owner', variables: [{ keyHash: null }, { tag: null }, { identity: null }, { addressSecret: null }] },
    // A vault address.
    receive: { output: 'vaultOutput', role: 'owner', variables: [{ tag: null }, { identity: null }, { addressSecret: null }] },
  },
  roles: { owner: view('Owner', 'Holds the wallet\'s seed and spends from it.') },
  start: [{ action: 'pay', role: 'owner' }],
  actions: {
    pay: {
      ...view('Pay', 'Pay from the wallet\'s coins. The wallet names the coins and the outputs.'),
      roles: { owner: { requirements: {} } },
      requirements: { participants: [one('owner')] },
      transaction: 'payTransaction',
    },
  },
  transactions: {
    payTransaction: { ...view('Paid'), inputs: [], outputs: [], version: 2, locktime: 0 },
  },
  inputs: {
    sweptInput: { ...view('Coin of an earlier seed', 'Released through the controller with the owner\'s approval.'), unlockingScript: 'unlockSweep' },
    vaultInput: { ...view('Vault coin', 'Released through the controller with the owner\'s approval.'), unlockingScript: 'unlockVault' },
  },
  outputs: {
    vaultOutput: { ...view('Vault address'), lockingScript: 'vaultLockingScript', valueSatoshis: '1000' },
  },
  lockingScripts: {
    earlierAddressLockingScript: {
      ...view('Recoverable address of an earlier seed', 'The wallet\'s current owner moves it through the controller.'),
      lockingType: 'p2sh',
      lockingBytecode: 'earlierAddressBytecode',
      unlockingBytecode: 'unlockSweep',
      state: { variables: ['keyHash', 'tag', 'identity', 'addressSecret'] },
      roles: { owner: { ...holds, actions: [] } },
    },
    vaultLockingScript: {
      ...view('Vault address', 'An address without a key: only the wallet\'s current owner spends from it, through the controller.'),
      lockingType: 'p2sh',
      lockingBytecode: 'vaultBytecode',
      unlockingBytecode: 'unlockVault',
      state: { variables: ['tag', 'identity', 'addressSecret'] },
      roles: { owner: { ...holds, actions: [] } },
    },
  },
  scripts: {
    earlierAddressBytecode: `<keyHash> <tag> 0x${recoverableAddressBytecodeHex}`,
    vaultBytecode: `<tag> 0x${vaultAddressBytecodeHex}`,
    // The secret, the identity as contracts see it, then the number of the contract's function.
    unlockSweep: '<addressSecret> <$(<identity> OP_REVERSEBYTES)> <1>',
    // The vault address has one function, so there is no number.
    unlockVault: '<addressSecret> <$(<identity> OP_REVERSEBYTES)>',
  },
  variables: {
    identity: { ...view('Wallet identity', 'The token category of the controller.'), type: 'token_category' },
    keyHash: { ...view('Key hash', 'The hash of the key an earlier seed made for this address.'), type: 'bytes' },
    tag: { ...view('Address tag', 'Ties the address to the wallet without showing which.'), type: 'bytes' },
    addressSecret: { ...view('Address secret', 'With the identity, what the controller path shows for this address.'), type: 'bytes' },
  },
} as const satisfies Record<string, unknown>;

/** The templates the wallet brings to an account, by the name the wallet's code uses for each. */
export const WALLET_TEMPLATES = {
  controller: controllerTemplate as unknown as XOTemplate,
  givenOut: givenOutTemplate as unknown as XOTemplate,
  change: changeTemplate as unknown as XOTemplate,
  actions: walletActionsTemplate as unknown as XOTemplate,
  /** XO's standard single-key wallet: ordinary coins, the funding address, the recoverer's fee address. */
  coins: p2pkhTemplate as unknown as XOTemplate,
};

export type WalletTemplateName = keyof typeof WALLET_TEMPLATES;

/** The identifier of each template: the hash of its content. */
export const walletTemplateIdentifiers = (): Record<WalletTemplateName, string> => ({
  controller: generateTemplateIdentifier(WALLET_TEMPLATES.controller),
  givenOut: generateTemplateIdentifier(WALLET_TEMPLATES.givenOut),
  change: generateTemplateIdentifier(WALLET_TEMPLATES.change),
  actions: generateTemplateIdentifier(WALLET_TEMPLATES.actions),
  coins: generateTemplateIdentifier(WALLET_TEMPLATES.coins),
});

/** The numbers under which the engine derives the keys of the templates that hold keys (proposal section 7.2). */
export const walletTemplateNumbers = (): TemplateNumbers => {
  const identifiers = walletTemplateIdentifiers();
  return {
    controller: xoTemplateIndex(identifiers.controller),
    givenOut: xoTemplateIndex(identifiers.givenOut),
    change: xoTemplateIndex(identifiers.change),
    standardWallet: xoTemplateIndex(identifiers.coins),
  };
};
