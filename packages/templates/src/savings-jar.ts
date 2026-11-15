import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';
import type { XOTemplate } from '@xo-cash/types';

/**
 * The XO template for the Savings Jar, a small application that relies on a Grandma's Wallet for
 * authorization.
 *
 * A jar is bound to a wallet identity and an unlock time. It holds no key, so this template has no secrets
 * and is independent of the wallet template: anyone can pay into a jar, and after the unlock time its funds
 * are released by the wallet's owner approving a transaction through the wallet's controller (the wallet
 * template's `approve` action, with the jar as an extra input).
 *
 * Because a jar belongs to the wallet's identity and not to a key, it stays in place when the wallet's owner
 * key is replaced, and the new owner is the one who can empty it.
 */
export const savingsJarTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: 'Savings Jar',
  description:
    'Funds set aside for a wallet until a chosen time. Anyone can pay into a jar. After its unlock time, the owner of the wallet it belongs to can empty it by approving the withdrawal with that wallet. Replacing the wallet\'s owner key changes who can empty the jar, never when.',
  icon: 'savings',
  version: '1',
  supported: ['BCH_2026_05'],

  roles: {
    saver: {
      name: 'Saver',
      description: 'Pays into a savings jar, or keeps track of one.',
      icon: 'owner',
    },
  },

  start: [{ action: 'deposit', role: 'saver' }],

  defaults: {
    // Both give a jar's address for a wallet identity and an unlock time.
    receive: { output: 'savingsJarOutput', role: 'saver' },
    address: { lockingScript: 'savingsJarLockingScript', role: 'saver' },
  },

  actions: {
    deposit: {
      name: 'Pay into a savings jar',
      description: 'Lock funds for a wallet until the jar\'s unlock time.',
      icon: 'savings',
      roles: {
        saver: { requirements: { variables: ['identity', 'unlockTime', 'savedSatoshis'] } },
      },
      requirements: { participants: [{ role: 'saver', slots: { min: 1, max: 1 } }] },
      transaction: 'depositTransaction',
    },
  },

  transactions: {
    depositTransaction: {
      name: 'Paid into a savings jar',
      description: '$(<savedSatoshis>) satoshis were locked in a savings jar.',
      icon: 'savings',
      inputs: [],
      outputs: [{ output: 'savingsJarOutput' }],
      version: 2,
      locktime: 0,
    },
  },

  inputs: {},

  outputs: {
    savingsJarOutput: {
      name: 'Savings jar',
      description: '$(<savedSatoshis>) satoshis locked until the jar\'s unlock time.',
      icon: 'savings',
      lockingScript: 'savingsJarLockingScript',
      valueSatoshis: '$(<savedSatoshis>)',
      token: null,
    },
  },

  lockingScripts: {
    savingsJarLockingScript: {
      name: 'Savings jar',
      description:
        'Funds locked until the unlock time, then spendable in a transaction approved by the owner of the wallet the jar belongs to.',
      icon: 'savings',
      lockingType: 'p2sh',
      lockingBytecode: 'savingsJarBytecode',
      unlockingBytecode: 'unlockSavingsJar',
      state: { variables: ['identity', 'unlockTime'] },
      roles: {
        saver: { balance: { satoshis: true }, selectable: false },
      },
    },
  },

  scripts: {
    // The compiled contract preceded by its constructor arguments, last argument first. Contracts see a
    // token category in the reverse of the byte order used for the identity elsewhere.
    savingsJarBytecode: `<unlockTime> <$(<identity> OP_REVERSEBYTES)> 0x${savingsJarBytecodeHex}`,
    // A jar takes no arguments: the script itself is all that is needed to unlock it.
    unlockSavingsJar: '',
  },

  variables: {
    identity: {
      name: 'Wallet identity',
      description: 'The token category that identifies the wallet the jar belongs to.',
      type: 'token_category',
    },
    unlockTime: {
      name: 'Unlock time',
      description: 'When the jar can be emptied, as a Unix timestamp.',
      type: 'integer',
    },
    savedSatoshis: {
      name: 'Amount to save',
      description: 'Satoshis to lock in the jar.',
      type: 'satoshis',
    },
  },
} satisfies XOTemplate;
