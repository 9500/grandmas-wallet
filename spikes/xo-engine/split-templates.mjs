// Trial templates with the controller and the addresses apart. The engine derives a template's keys under
// the template's identifier, so keeping them apart puts the controller key and the address keys in
// different hardened branches of the key tree.
import { readFileSync } from 'node:fs';

const hexOf = (name) => readFileSync(new URL(`../addresses/artifacts/${name}.hex`, import.meta.url), 'utf8').trim();
const view = (name, description = name) => ({ name, description });
const one = (role) => ({ role, slots: { min: 1, max: 1 } });
const ZERO20 = '00'.repeat(20);
const holds = { balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true };
const controllerToken = (commitment) => ({ category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment } });
const base = { $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json', version: '0', supported: ['BCH_2026_05'], roles: { owner: view('Owner') } };

export const controllerTemplate = {
  ...base,
  ...view('Controller (stage 0 trial)'),
  // Makes the controller of an existing identity known to an account, under a key the account already has.
  defaults: { address: { lockingScript: 'controllerLockingScript', role: 'owner', variables: [{ identity: null }] } },
  start: [{ action: 'create', role: 'owner', generate: ['controllerKey'] }],
  actions: {
    create: {
      ...view('Create the wallet'),
      roles: { owner: { generate: ['controllerKey'], requirements: { variables: ['identity', 'ownerKeyHash', 'recovererKeyHash'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'createTransaction',
    },
    update: {
      ...view('Change the owner'),
      roles: { owner: { requirements: { variables: ['identity', 'newEpoch', 'newOwnerKeyHash', 'newRecovererKeyHash', 'newDelay'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'updateTransaction',
    },
    sweep: {
      ...view('Sweep'),
      roles: { owner: { requirements: { variables: ['identity', 'stateBody', 'sentSatoshis', 'recipientLockingScript'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'sweepTransaction',
    },
  },
  transactions: {
    createTransaction: { ...view('Wallet created'), inputs: [], outputs: [{ output: 'initialControllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    updateTransaction: { ...view('Owner changed'), inputs: [{ input: 'controllerUpdateInput', inputIndex: 0 }], outputs: [{ output: 'updatedControllerOutput', outputIndex: 0 }], version: 2, locktime: 0 },
    sweepTransaction: { ...view('Swept'), inputs: [{ input: 'controllerOwnerInput', inputIndex: 0 }], outputs: [{ output: 'activeControllerOutput', outputIndex: 0 }, { output: 'paymentOutput' }], version: 2, locktime: 0 },
  },
  inputs: {
    controllerOwnerInput: { ...view('Controller'), unlockingScript: 'unlockOwnerAuthorize' },
    controllerUpdateInput: { ...view('Controller'), unlockingScript: 'unlockOwnerUpdate' },
  },
  outputs: {
    initialControllerOutput: { ...view('Controller'), lockingScript: 'controllerLockingScript', valueSatoshis: '1000', token: controllerToken(`$(<"010000000000"> <ownerKeyHash> OP_CAT <recovererKeyHash> OP_CAT <"010040${ZERO20}"> OP_CAT)`) },
    activeControllerOutput: { ...view('Controller'), lockingScript: 'controllerLockingScript', valueSatoshis: '1000', token: controllerToken(`$(<"0100"> <stateBody> OP_CAT <"${ZERO20}"> OP_CAT)`) },
    updatedControllerOutput: { ...view('Controller'), lockingScript: 'controllerLockingScript', valueSatoshis: '1000', token: controllerToken(`$(<"0100"> <newEpoch> OP_CAT <newOwnerKeyHash> OP_CAT <newRecovererKeyHash> OP_CAT <newDelay> OP_CAT <"${ZERO20}"> OP_CAT)`) },
    paymentOutput: { ...view('Payment'), lockingScript: '$(<recipientLockingScript>)', valueSatoshis: '$(<sentSatoshis>)' },
  },
  lockingScripts: {
    controllerLockingScript: {
      ...view('Recovery controller'),
      lockingType: 'p2sh',
      lockingBytecode: 'controllerBytecode',
      state: { variables: ['identity'] },
      roles: { owner: { state: { secrets: ['controllerKey'] }, actions: [{ action: 'sweep', role: 'owner', secrets: [{ controllerKey: null }] }, { action: 'update', role: 'owner', secrets: [{ controllerKey: null }] }] } },
    },
  },
  scripts: {
    controllerBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${hexOf('controller')}`,
    unlockOwnerAuthorize: '<controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <0>',
    unlockOwnerUpdate: '<newDelay> <newRecovererKeyHash> <newOwnerKeyHash> <controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <3>',
  },
  variables: {
    controllerKey: { ...view('Controller key'), type: 'private_key' },
    identity: { ...view('Wallet identity'), type: 'token_category' },
    ownerKeyHash: { ...view('Owner key hash'), type: 'bytes' },
    recovererKeyHash: { ...view('Recoverer key hash'), type: 'bytes' },
    stateBody: { ...view('Controller state: epoch, owner, recoverer, delay'), type: 'bytes' },
    newEpoch: { ...view('Epoch after the change'), type: 'bytes' },
    newOwnerKeyHash: { ...view('New owner key hash'), type: 'bytes' },
    newRecovererKeyHash: { ...view('New recoverer key hash'), type: 'bytes' },
    newDelay: { ...view('New waiting period'), type: 'bytes' },
    sentSatoshis: { ...view('Amount'), type: 'satoshis' },
    recipientLockingScript: { ...view('Recipient'), type: 'locking_script' },
  },
};

export const addressTemplate = {
  ...base,
  ...view('Recoverable addresses (stage 0 trial)'),
  defaults: {
    // An address of this account's seed: a new key, the caller's tag.
    address: { lockingScript: 'ownAddressLockingScript', role: 'owner', generate: ['addressKey'], variables: [{ tag: null }, { identity: null }, { addressSecret: null }] },
    // An address of an earlier seed: the caller's key hash and tag; it can only be swept.
    receive: { output: 'earlierAddressOutput', role: 'owner', variables: [{ keyHash: null }, { tag: null }, { identity: null }, { addressSecret: null }] },
  },
  start: [],
  actions: {},
  transactions: {},
  inputs: { spendInput: { ...view('Coin, by its key'), unlockingScript: 'unlockSpend' } },
  outputs: { earlierAddressOutput: { ...view('Address of an earlier seed'), lockingScript: 'earlierAddressLockingScript', valueSatoshis: '1000' } },
  lockingScripts: {
    ownAddressLockingScript: {
      ...view('Recoverable address'),
      lockingType: 'p2sh',
      lockingBytecode: 'ownAddressBytecode',
      unlockingBytecode: 'unlockSpend',
      state: { variables: ['tag', 'identity', 'addressSecret'] },
      roles: { owner: { state: { secrets: ['addressKey'] }, ...holds, actions: [] } },
    },
    earlierAddressLockingScript: {
      ...view('Recoverable address of an earlier seed'),
      lockingType: 'p2sh',
      lockingBytecode: 'earlierAddressBytecode',
      unlockingBytecode: 'unlockSweep',
      state: { variables: ['keyHash', 'tag', 'identity', 'addressSecret'] },
      roles: { owner: { ...holds, actions: [] } },
    },
  },
  scripts: {
    ownAddressBytecode: `<$(<addressKey.public_key> OP_HASH160)> <tag> 0x${hexOf('recoverableAddress')}`,
    earlierAddressBytecode: `<keyHash> <tag> 0x${hexOf('recoverableAddress')}`,
    unlockSpend: '<addressKey.schnorr_signature.all_outputs> <addressKey.public_key> <0>',
    unlockSweep: '<addressSecret> <$(<identity> OP_REVERSEBYTES)> <1>',
  },
  variables: {
    addressKey: { ...view('Address key'), type: 'private_key' },
    identity: { ...view('Wallet identity'), type: 'token_category' },
    tag: { ...view('Address tag'), type: 'bytes' },
    addressSecret: { ...view('Address secret'), type: 'bytes' },
    keyHash: { ...view('Key hash of the address'), type: 'bytes' },
  },
};
