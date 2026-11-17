// A trial XO template for the wallet of the v0.4 design: the controller, the recoverable address held by
// this account's own key, and the same address held by a key this account does not have (an earlier seed's).
import { readFileSync } from 'node:fs';

const hexOf = (name) => readFileSync(new URL(`../addresses/artifacts/${name}.hex`, import.meta.url), 'utf8').trim();
const view = (name, description = name) => ({ name, description });
const one = (role) => ({ role, slots: { min: 1, max: 1 } });
const ZERO20 = '00'.repeat(20);
const holds = { balance: { satoshis: true, fungibleTokens: true, nonfungibleTokens: true }, selectable: true };
const controllerToken = (commitment) => ({ category: '$(<identity>)', amount: null, nft: { capability: 'mutable', commitment } });

export const walletTrialTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Grandma\'s Wallet (stage 0 trial)'),
  version: '0',
  supported: ['BCH_2026_05'],
  defaults: {
    address: { lockingScript: 'ownAddressLockingScript', role: 'owner', generate: ['addressKey'], variables: [{ tag: null }, { identity: null }, { addressSecret: null }] },
    receive: { output: 'foreignAddressOutput', role: 'owner', variables: [{ keyHash: null }, { tag: null }, { identity: null }, { addressSecret: null }] },
  },
  roles: { owner: view('Owner') },
  start: [{ action: 'create', role: 'owner', generate: ['controllerKey'] }],
  actions: {
    create: {
      ...view('Create the wallet'),
      roles: { owner: { generate: ['controllerKey'], requirements: { variables: ['identity', 'ownerKeyHash', 'recovererKeyHash'], secrets: ['controllerKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'createTransaction',
    },
    pay: {
      ...view('Pay'),
      roles: { owner: { requirements: { variables: ['sentSatoshis', 'recipientLockingScript'], secrets: ['addressKey'] } } },
      requirements: { participants: [one('owner')] },
      transaction: 'payTransaction',
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
    payTransaction: { ...view('Paid'), inputs: [{ input: 'spendInput' }], outputs: [{ output: 'paymentOutput' }], version: 2, locktime: 0 },
    sweepTransaction: {
      ...view('Swept'),
      inputs: [{ input: 'controllerOwnerInput', inputIndex: 0 }, { input: 'sweptInput' }],
      outputs: [{ output: 'activeControllerOutput', outputIndex: 0 }, { output: 'paymentOutput' }],
      version: 2,
      locktime: 0,
    },
  },
  inputs: {
    controllerOwnerInput: { ...view('Controller'), unlockingScript: 'unlockOwnerAuthorize' },
    spendInput: { ...view('Coin, by its key'), unlockingScript: 'unlockSpend' },
    sweptInput: { ...view('Coin, through the controller'), unlockingScript: 'unlockSweep' },
  },
  outputs: {
    initialControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: controllerToken(`$(<"010000000000"> <ownerKeyHash> OP_CAT <recovererKeyHash> OP_CAT <"010040${ZERO20}"> OP_CAT)`),
    },
    activeControllerOutput: {
      ...view('Controller'),
      lockingScript: 'controllerLockingScript',
      valueSatoshis: '1000',
      token: controllerToken(`$(<"0100"> <stateBody> OP_CAT <"${ZERO20}"> OP_CAT)`),
    },
    paymentOutput: { ...view('Payment'), lockingScript: '$(<recipientLockingScript>)', valueSatoshis: '$(<sentSatoshis>)' },
    foreignAddressOutput: { ...view('Address of another seed'), lockingScript: 'foreignAddressLockingScript', valueSatoshis: '$(<sentSatoshis>)' },
  },
  lockingScripts: {
    controllerLockingScript: {
      ...view('Recovery controller'),
      lockingType: 'p2sh',
      lockingBytecode: 'controllerBytecode',
      state: { variables: ['identity'] },
      roles: { owner: { state: { secrets: ['controllerKey'] }, actions: [{ action: 'sweep', role: 'owner', secrets: [{ controllerKey: null }] }] } },
    },
    ownAddressLockingScript: {
      ...view('Recoverable address'),
      lockingType: 'p2sh',
      lockingBytecode: 'ownAddressBytecode',
      state: { variables: ['tag', 'identity', 'addressSecret'] },
      roles: { owner: { state: { secrets: ['addressKey'] }, ...holds, actions: [{ action: 'pay', role: 'owner', secrets: [{ addressKey: null }] }] } },
    },
    foreignAddressLockingScript: {
      ...view('Recoverable address of another seed'),
      lockingType: 'p2sh',
      lockingBytecode: 'foreignAddressBytecode',
      state: { variables: ['keyHash', 'tag', 'identity', 'addressSecret'] },
      roles: { owner: { ...holds, actions: [] } },
    },
  },
  scripts: {
    // Constructor arguments precede the compiled contract, last argument first.
    controllerBytecode: `<$(<identity> OP_REVERSEBYTES)> 0x${hexOf('controller')}`,
    ownAddressBytecode: `<$(<addressKey.public_key> OP_HASH160)> <tag> 0x${hexOf('recoverableAddress')}`,
    foreignAddressBytecode: `<keyHash> <tag> 0x${hexOf('recoverableAddress')}`,
    unlockOwnerAuthorize: '<controllerKey.schnorr_signature.all_outputs> <controllerKey.public_key> <0>',
    unlockSpend: '<addressKey.schnorr_signature.all_outputs> <addressKey.public_key> <0>',
    unlockSweep: '<addressSecret> <$(<identity> OP_REVERSEBYTES)> <1>',
  },
  variables: {
    controllerKey: { ...view('Controller key'), type: 'private_key' },
    addressKey: { ...view('Address key'), type: 'private_key' },
    identity: { ...view('Wallet identity'), type: 'token_category' },
    ownerKeyHash: { ...view('Owner key hash'), type: 'bytes' },
    recovererKeyHash: { ...view('Recoverer key hash'), type: 'bytes' },
    stateBody: { ...view('Controller state: epoch, owner, recoverer, delay'), type: 'bytes' },
    tag: { ...view('Address tag'), type: 'bytes' },
    addressSecret: { ...view('Address secret'), type: 'bytes' },
    keyHash: { ...view('Key hash of the address'), type: 'bytes' },
    sentSatoshis: { ...view('Amount'), type: 'satoshis' },
    recipientLockingScript: { ...view('Recipient'), type: 'locking_script' },
  },
};
