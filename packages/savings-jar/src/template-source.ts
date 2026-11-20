import { savingsJarBytecodeHex } from '@grandmas-wallet/contracts/savingsJar';

/**
 * The XO template of the Savings Jar application, in its version 4 (below), which a wallet takes alone.
 *
 * A jar holds savings until a date. Anyone can pay in. From the date on, whoever holds the jar's key token
 * can empty it. The template has no key and no secret: authority over a jar is its key token, which the
 * wallet keeps at an address of its own. The jar's address follows from the key alone, so a wallet that
 * holds the key and this template finds the jar on chain with nothing else.
 *
 * The text a wallet is sent is the frozen copy in `frozen/`, made from this source by `npm run freeze`.
 * A template is named by the hash of its text, so the text must not change by accident; a test compares
 * the two.
 */

const view = (name: string, description: string) => ({ name, description });
const action = (name: string, description: string, variables: string[], transaction: string) => ({
  ...view(name, description),
  roles: { saver: { requirements: { variables } } },
  requirements: { participants: [{ role: 'saver', slots: { min: 1, max: 1 } }] },
  transaction,
});

/**
 * Version 3, which the second design used with a recovery declaration (at the tag `design-2`). It is no longer
 * served; version 4 is made from it, so that the two give the same jar.
 */
const version3 = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  ...view('Savings Jar', 'Savings kept until a date. Anyone can pay into a jar. From its date on, whoever holds the jar\'s key can empty it.'),
  version: '3',
  supported: ['BCH_2026_05'],
  roles: { saver: view('Saver', 'Opens a jar, pays into it, and empties it from its date on.') },
  start: [
    { action: 'open', role: 'saver' },
    { action: 'deposit', role: 'saver' },
  ],
  actions: {
    open: action('Open a savings jar', 'Make a new jar with its key, and pay the first savings in. They stay in the jar until its date.', ['keyCategory', 'unlockTime', 'unlockTimeBytes', 'savedSatoshis', 'keyHolder'], 'openTransaction'),
    deposit: action('Pay into a savings jar', 'Add savings to a jar. They stay there until the jar\'s date.', ['keyCategory', 'unlockTime', 'savedSatoshis'], 'depositTransaction'),
    withdraw: action('Empty a savings jar', 'Take everything out of the jar. Possible from the jar\'s date on. The key stays with you, so the jar can be used again.', ['keyCategory', 'unlockTime', 'unlockTimeBytes', 'keyHolder', 'keyInput'], 'withdrawTransaction'),
  },
  transactions: {
    openTransaction: {
      ...view('Savings jar opened', 'A savings jar was opened with $(<savedSatoshis>) satoshis.'),
      inputs: [],
      outputs: [{ output: 'savingsJarOutput' }, { output: 'jarKeyOutput' }],
      version: 2,
      locktime: 0,
    },
    depositTransaction: { ...view('Paid into a savings jar', '$(<savedSatoshis>) satoshis were added to a savings jar.'), inputs: [], outputs: [{ output: 'savingsJarOutput' }], version: 2, locktime: 0 },
    withdrawTransaction: {
      ...view('Savings jar emptied', 'Everything was taken out of a savings jar.'),
      inputs: [{ input: 'savingsJarInput' }],
      outputs: [{ output: 'jarKeyOutput' }],
      version: 2,
      // The network takes the transaction only once this time has passed.
      locktime: '$(<unlockTime>)',
    },
  },
  inputs: {
    // A lock time counts only when an input's sequence number is below the highest.
    savingsJarInput: { ...view('Savings jar', 'Savings in the jar. They need no signature: the jar\'s key in the same transaction opens it.'), unlockingScript: 'unlockSavingsJar', sequenceNumber: 4294967294 },
  },
  outputs: {
    savingsJarOutput: { ...view('Savings jar', '$(<savedSatoshis>) satoshis kept until the jar\'s date.'), lockingScript: 'savingsJarLockingScript', valueSatoshis: '$(<savedSatoshis>)' },
    jarKeyOutput: {
      ...view('Jar key', 'The token that opens this jar. Keep it in the wallet.'),
      lockingScript: '$(<keyHolder>)',
      valueSatoshis: '1000',
      token: { category: '$(<keyCategory>)', amount: null, nft: { capability: 'none', commitment: '$(<unlockTimeBytes>)' } },
    },
  },
  lockingScripts: {
    savingsJarLockingScript: {
      ...view('Savings jar', 'Savings kept until the jar\'s date; then whoever spends the jar\'s key in the same transaction can take them out.'),
      lockingType: 'p2sh',
      lockingBytecode: 'savingsJarBytecode',
      unlockingBytecode: 'unlockSavingsJar',
      state: { variables: ['keyCategory', 'unlockTime'] },
      roles: { saver: { balance: { satoshis: true }, selectable: false, actions: [{ action: 'withdraw', role: 'saver' }] } },
    },
  },
  scripts: {
    // The compiled contract preceded by its arguments, last first. Contracts see a token category in the
    // reverse of the byte order used elsewhere.
    savingsJarBytecode: `<unlockTime> <$(<keyCategory> OP_REVERSEBYTES)> 0x${savingsJarBytecodeHex}`,
    // The number of the input that spends the key.
    unlockSavingsJar: '<keyInput>',
  },
  variables: {
    keyCategory: { ...view('Jar key', 'The token category of the jar\'s key.'), type: 'token_category' },
    // Not `timestamp`: the engine reads a stored value of that type back as text when it unlocks a coin.
    unlockTime: { ...view('Opens on', 'When the jar can be emptied, as a Unix time.'), type: 'integer' },
    unlockTimeBytes: { ...view('Date on the key', 'The same time, as it is written on the jar\'s key.'), type: 'bytes' },
    savedSatoshis: { ...view('Amount to save', 'Satoshis to put into the jar.'), type: 'satoshis' },
    keyHolder: { ...view('Key holder', 'Where the jar\'s key goes: an address of the wallet.'), type: 'locking_script' },
    keyInput: { ...view('Key input', 'The number of the input that spends the jar\'s key.'), type: 'integer' },
  },
} as const;

/**
 * Version 4 of the template, for a wallet that takes nothing but the template (proposal section 15.3). The
 * contract is the same, and so is every script but the jar's unlocking: a jar of either version is at the
 * address its key's category and date give, and is emptied by the same contract.
 *
 * - **The key is an input of its own.** `jarKeyInput` names the key's category and has no unlocking script: the
 *   wallet puts its own key coin there, signed by the key's address, and a wallet knows from the template alone
 *   that the withdrawal spends the key. It is input 0 of the withdrawal, the jar's coins after it.
 * - **The jar's unlocking gives that index as a constant,** `<0>`, in place of the variable `keyInput` that a
 *   declaration used to fill. Everything else a withdrawal needs is in the wallet's record of the jar (the
 *   script's two values and the date as written on the key) or is the wallet's own to give (the key's address),
 *   so a wallet empties a jar by itself, after a recovery too.
 * - **The date stays on the key.** An ordinary wallet keeps no record; the jar's page finds such a wallet's jars
 *   from the key's category and the date written on it.
 *
 * Field order is that of version 3: a template's identifier depends on it.
 */
export const savingsJarV4TemplateSource = {
  ...version3,
  version: '4',
  actions: {
    ...version3.actions,
    withdraw: action('Empty a savings jar', 'Take everything out of the jar. Possible from the jar\'s date on. The key stays with you, so the jar can be used again.', ['keyCategory', 'unlockTime', 'unlockTimeBytes', 'keyHolder'], 'withdrawTransaction'),
  },
  transactions: {
    ...version3.transactions,
    withdrawTransaction: {
      ...version3.transactions.withdrawTransaction,
      // The key first, at the place the jar's unlocking names; the jar's coins after it.
      inputs: [{ input: 'jarKeyInput', inputIndex: 0 }, { input: 'savingsJarInput' }],
    },
  },
  inputs: {
    ...version3.inputs,
    // The wallet's own coin with the key: no unlocking script here, its address's key signs it.
    jarKeyInput: { ...view('Jar key', 'The jar\'s key, spent and given back. It opens the jar.'), token: { category: '$(<keyCategory>)' } },
  },
  scripts: {
    ...version3.scripts,
    // The key is input 0 of the withdrawal.
    unlockSavingsJar: '<0>',
  },
  variables: (({ keyInput: _keyInput, ...rest }) => rest)(version3.variables),
} as const;
